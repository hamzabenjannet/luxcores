import {
  Logger,
  type BeforeApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type AmqpConnectionManager,
  type ChannelWrapper,
  connect,
} from 'amqp-connection-manager';
import { EventBus, type EventMap, type EventPattern } from './event-bus.js';

const CONNECT_TIMEOUT_MS = 10_000;

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
  implements OnModuleInit, BeforeApplicationShutdown
{
  readonly mode = 'rabbitmq' as const;
  private readonly logger = new Logger('EventBus');
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;

  constructor(
    private readonly url: string,
    private readonly queue: string,
  ) {
    super();
  }

  /** Fails the start-up with a clear message when the broker is unreachable. */
  async onModuleInit(): Promise<void> {
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
    if (!this.channel) throw new Error('RabbitMQ publisher is not connected');
    await this.channel.sendToQueue(
      this.queue,
      { pattern, data: payload },
      { persistent: true },
    );
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
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(message)),
          CONNECT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Opens and closes one connection to prove the broker answers. `main.ts` calls it
 * before it attaches the consumer, because Nest's RabbitMQ server retries for
 * ever and would leave the process half started.
 */
export async function assertBrokerReachable(url: string): Promise<void> {
  const connection = connect([url]);
  connection.on('connectFailed', () => undefined); // a failed try is reported by the timeout below
  try {
    await withTimeout(
      new Promise<void>((resolve) =>
        connection.once('connect', () => resolve()),
      ),
      `RabbitMQ is unreachable at ${redact(url)}`,
    );
  } finally {
    await connection.close().catch(() => undefined);
  }
}
