import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type AmqpConnectionManager,
  type ChannelWrapper,
  connect,
} from 'amqp-connection-manager';
import type { ConsumeMessage } from 'amqplib';
import type { MatchRpc, MatchRpcHandler } from './cluster.types.js';
import { CommandBus } from './command-bus.js';

const MATCH_ID = /^[0-9a-zA-Z-]{1,64}$/;
const REPLY_TO = 'amq.rabbitmq.reply-to';

/**
 * Queue arguments. They are the same on every node, because RabbitMQ refuses a declaration with other
 * arguments. A request that waits more than 5 seconds is stale, and a queue nobody consumes for a
 * minute goes away by itself.
 */
const QUEUE_ARGS = {
  durable: false,
  autoDelete: false,
  arguments: { 'x-message-ttl': 5000, 'x-expires': 60_000, 'x-max-length': 2000 },
};

export const matchQueue = (matchId: string): string => {
  if (!MATCH_ID.test(matchId)) throw new Error(`Bad match id for a queue name: ${matchId}`);
  return `luxcores.match.${matchId}.commands`;
};

interface Pending {
  resolve: (reply: unknown | null) => void;
  timer: NodeJS.Timeout;
}

/**
 * One RabbitMQ queue per running match, `luxcores.match.<id>.commands`. The node that runs the match
 * consumes it. Any other node sends a request with a direct reply-to and waits for the answer, so the
 * socket acknowledgement keeps its meaning (accepted, tick, reason) whichever node holds the client.
 */
export class RabbitCommandBus extends CommandBus {
  readonly mode = 'rabbitmq' as const;
  private readonly logger = new Logger('CommandBus');
  private readonly pending = new Map<string, Pending>();
  private readonly consumers = new Map<string, string>();
  private connection!: AmqpConnectionManager;
  /** Publishes requests and receives replies. Direct reply-to needs both on one channel. */
  private caller!: ChannelWrapper;
  /** Consumes the queues of the matches this node runs, and publishes the replies. */
  private server!: ChannelWrapper;

  constructor(private readonly url: string) {
    super();
  }

  /** Connects, or rejects within `timeoutMs`. */
  async connect(timeoutMs: number): Promise<void> {
    this.connection = connect([this.url]);
    this.connection.on('connectFailed', () => undefined); // the timeout below reports an unreachable broker
    this.caller = this.connection.createChannel({
      json: true,
      setup: async (channel: { consume(queue: string, onMessage: (msg: ConsumeMessage | null) => void, options: object): Promise<unknown> }) => {
        await channel.consume(REPLY_TO, (msg) => this.onReply(msg), { noAck: true });
      },
    });
    this.server = this.connection.createChannel({ json: true });
    try {
      await Promise.race([
        Promise.all([this.caller.waitForConnect(), this.server.waitForConnect()]),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('RabbitMQ did not answer in time')), timeoutMs).unref();
        }),
      ]);
    } catch (err) {
      await this.connection.close().catch(() => undefined);
      throw err;
    }
  }

  async serve(matchId: string, handler: MatchRpcHandler): Promise<void> {
    const queue = matchQueue(matchId);
    await this.server.assertQueue(queue, QUEUE_ARGS);
    const { consumerTag } = await this.server.consume(
      queue,
      (msg) => void this.answer(msg, handler),
      { noAck: false, prefetch: 50 },
    );
    this.consumers.set(matchId, consumerTag);
  }

  async unserve(matchId: string): Promise<void> {
    const tag = this.consumers.get(matchId);
    this.consumers.delete(matchId);
    try {
      if (tag) await this.server.cancel(tag);
      await this.server.deleteQueue(matchQueue(matchId));
    } catch (err) {
      this.logger.warn(`Removing the queue of ${matchId} failed: ${(err as Error).message}`);
    }
  }

  request(matchId: string, rpc: MatchRpc, timeoutMs: number): Promise<unknown | null> {
    if (!this.connection.isConnected()) return Promise.resolve(null);
    const correlationId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        resolve(null);
      }, timeoutMs);
      this.pending.set(correlationId, { resolve, timer });
      this.caller
        .sendToQueue(matchQueue(matchId), rpc, { replyTo: REPLY_TO, correlationId, expiration: String(timeoutMs) })
        .catch(() => undefined); // the timeout answers
    });
  }

  async close(): Promise<void> {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(null);
    }
    this.pending.clear();
    await this.caller?.close().catch(() => undefined);
    await this.server?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  private onReply(msg: ConsumeMessage | null): void {
    const entry = msg ? this.pending.get(msg.properties.correlationId as string) : undefined;
    if (!msg || !entry) return;
    this.pending.delete(msg.properties.correlationId as string);
    clearTimeout(entry.timer);
    try {
      entry.resolve(JSON.parse(msg.content.toString()));
    } catch {
      entry.resolve(null);
    }
  }

  private async answer(msg: ConsumeMessage | null, handler: MatchRpcHandler): Promise<void> {
    if (!msg) return;
    let reply: unknown;
    try {
      reply = await handler(JSON.parse(msg.content.toString()) as MatchRpc);
    } catch (err) {
      reply = { error: (err as Error).message };
    }
    const { replyTo, correlationId } = msg.properties as { replyTo?: string; correlationId?: string };
    if (replyTo) {
      await this.server
        .sendToQueue(replyTo, reply ?? null, { correlationId })
        .catch((err: Error) => this.logger.warn(`Replying failed: ${err.message}`));
    }
    this.server.ack(msg);
  }
}
