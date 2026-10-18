import { Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import {
  type AmqpConnectionManager,
  type ChannelWrapper,
  connect,
} from 'amqp-connection-manager';
import { EventBus, type EventMap, type EventPattern } from './event-bus.js';

const CONNECT_TIMEOUT_MS = 10_000;
/** A publish that takes longer than this is treated as lost, and the in-process bus delivers the event instead. */
const PUBLISH_TIMEOUT_MS = 2000;

/**
 * Publishes events to a durable RabbitMQ queue, in the `{ pattern, data }` format
 * that Nest's RabbitMQ transport consumes (`EventsController`).
 *
 * It talks to the broker through `amqp-connection-manager` directly instead of
 * Nest's `ClientProxy`: against RabbitMQ 3.13, `ClientProxy.close()` never
 * returned, which would hang a graceful shutdown. A plain channel closes in
 * milliseconds and reconnects on its own after a broker restart.
 */
export class RabbitMqEventBus
  extends EventBus
  implements BeforeApplicationShutdown
{
  readonly mode = 'rabbitmq' as const;
  private readonly logger = new Logger('EventBus');
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;

  constructor(
    private readonly url: string,
    private readonly queue: string,
    /** Takes an event when the broker cannot, so a result is never lost to an outage. */
    private readonly fallback: EventBus,
    private readonly connectTimeoutMs = CONNECT_TIMEOUT_MS,
  ) {
    super();
  }

  /** Connects, or rejects with a clear message when the broker is unreachable. The caller then uses the fallback. */
  async connect(): Promise<void> {
    this.connection = connect([this.url]);
    this.channel = this.connection.createChannel({
      json: true,
      // The consumer declares the same queue with the same options, or RabbitMQ refuses the mismatch.
      setup: (channel: {
        assertQueue(queue: string, options: object): Promise<unknown>;
      }) => channel.assertQueue(this.queue, { durable: true }),
    });
    try {
      await withTimeout(
        this.channel.waitForConnect(),
        `RabbitMQ is unreachable at ${redact(this.url)}`,
        this.connectTimeoutMs,
      );
    } catch (err) {
      await this.connection.close().catch(() => undefined);
      throw err;
    }
    this.logger.log(`RabbitMQ publisher connected, queue "${this.queue}"`);
  }

  /** The second shutdown phase: after the match runner has published its last events, before the database closes. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  async publish<K extends EventPattern>(
    pattern: K,
    payload: EventMap[K],
  ): Promise<void> {
    // While the broker is away, the channel would hold the message until it returns, and a match could not end.
    if (!this.channel || !this.connection?.isConnected()) return this.fallback.publish(pattern, payload);
    try {
      await withTimeout(
        this.channel.sendToQueue(this.queue, { pattern, data: payload }, { persistent: true }),
        'RabbitMQ did not take the event in time',
        PUBLISH_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.warn(`${pattern} went to the in-process bus instead: ${(err as Error).message}`);
      await this.fallback.publish(pattern, payload);
    }
  }
}

/** Hides the password of an AMQP URL for log and error messages. */
function redact(url: string): string {
  return url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
}

/** Rejects with `message` when `work` takes longer than the connect timeout. */
async function withTimeout(
  work: Promise<unknown>,
  message: string,
  ms = CONNECT_TIMEOUT_MS,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
