import type { MatchFinishedEvent } from '../players/player-stats.service.js';

export interface MatchStartedEvent {
  matchId: string;
  seed: number;
  players: { playerId?: string; team: number; kind: 'human' | 'bot' }[];
}

/** Domain events, by pattern. The pattern is also the RabbitMQ message pattern. */
export interface EventMap {
  'match.started': MatchStartedEvent;
  'match.finished': MatchFinishedEvent;
}

export type EventPattern = keyof EventMap;

/**
 * How services announce what happened. With `RABBITMQ_URL` set, events travel
 * through RabbitMQ and any node can consume them. Without it, an in-process
 * bus calls the same handlers directly, so a single-node dev setup needs no broker.
 */
export abstract class EventBus {
  abstract readonly mode: 'rabbitmq' | 'local';
  abstract publish<K extends EventPattern>(
    pattern: K,
    payload: EventMap[K],
  ): Promise<void>;
}
