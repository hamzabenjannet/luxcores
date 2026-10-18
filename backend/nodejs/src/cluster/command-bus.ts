import type { MatchRpc, MatchRpcHandler } from './cluster.types.js';

/**
 * How a request reaches the node that runs a match. The node that runs it calls `serve` once
 * per match. Any node calls `request`. With RabbitMQ each match has its own queue, so a node
 * that dies leaves nothing behind but one idle queue that expires; without it, the in-process
 * bus reaches matches of the same server only.
 */
export abstract class CommandBus {
  abstract readonly mode: 'local' | 'rabbitmq';
  /** Starts answering requests for a match. */
  abstract serve(matchId: string, handler: MatchRpcHandler): Promise<void>;
  /** Stops answering and removes the match's queue. */
  abstract unserve(matchId: string): Promise<void>;
  /**
   * Sends a request to the node that serves the match and waits for its reply.
   * Resolves null when nobody answers within `timeoutMs`.
   */
  abstract request(matchId: string, rpc: MatchRpc, timeoutMs: number): Promise<unknown | null>;
  abstract close(): Promise<void>;
}

/** Requests go straight to a handler of the same process. */
export class LocalCommandBus extends CommandBus {
  readonly mode = 'local' as const;
  private readonly handlers = new Map<string, MatchRpcHandler>();

  async serve(matchId: string, handler: MatchRpcHandler): Promise<void> {
    this.handlers.set(matchId, handler);
  }

  async unserve(matchId: string): Promise<void> {
    this.handlers.delete(matchId);
  }

  async request(matchId: string, rpc: MatchRpc, _timeoutMs?: number): Promise<unknown | null> {
    const handler = this.handlers.get(matchId);
    if (!handler) return null;
    try {
      return await handler(rpc);
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
