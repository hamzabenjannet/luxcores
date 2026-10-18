import type { SimCommand } from '../simulation/sim.types.js';

/**
 * What a node can ask the node that runs a match. The asking node has the client's socket; the
 * owner has the sim. Each request gets one reply.
 */
export type MatchRpc =
  | { t: 'command'; playerId: string; seq: number; cmd: SimCommand }
  | { t: 'join'; playerId: string }
  | { t: 'stop' };

/** The reply to a `join` request. */
export interface JoinInfo {
  nextSeq: number;
  /** A `MatchSnapshot`, as the owner builds it. */
  snapshot: unknown;
}

/** Runs a request on the owner and returns its reply. A throw becomes an error reply. */
export type MatchRpcHandler = (rpc: MatchRpc) => Promise<unknown>;

/** The reply of a request that failed on the owner. */
export interface RpcFailure {
  error: string;
}

export const isRpcFailure = (reply: unknown): reply is RpcFailure =>
  typeof reply === 'object' && reply !== null && typeof (reply as RpcFailure).error === 'string' && Object.keys(reply).length === 1;
