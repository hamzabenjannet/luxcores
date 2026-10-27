// @ts-check
/**
 * Replay recording and playback.
 *
 * A match is fully described by: config (data) + seed + players + ordered
 * command log. Hashes are recorded every HASH_INTERVAL ticks so playback
 * can find the first divergent tick.
 */

import { createState } from './state.js';
import { step } from './step.js';
import { hashState } from './hash.js';
import { SPEC_VERSION } from './config.js';

export const HASH_INTERVAL = 20;
export const REPLAY_VERSION = 1;

/**
 * @typedef {Object} Replay
 * @property {number} version
 * @property {string} specVersion
 * @property {string} dataHash      hash of the raw data files, computed by the caller
 * @property {number} mapgenVersion
 * @property {number} seed
 * @property {import('./state.js').Player[]} players
 * @property {number} ticks         total ticks simulated
 * @property {import('./commands.js').CommandEnvelope[]} commands
 * @property {Record<string, string>} hashes  tick -> state hash
 * @property {import('./config.js').MatchOptions} [options]  settings of this match, such as the entropy rate or the creep cap; absent for a default match
 */

export class Recorder {
  /**
   * @param {{ seed: number, players: import('./state.js').Player[], dataHash: string, mapgenVersion: number, options?: import('./config.js').MatchOptions }} meta
   */
  constructor(meta) {
    /** @type {Replay} */
    this.replay = {
      version: REPLAY_VERSION,
      specVersion: SPEC_VERSION,
      dataHash: meta.dataHash,
      mapgenVersion: meta.mapgenVersion,
      seed: meta.seed,
      players: meta.players.map((p) => ({ ...p })),
      ticks: 0,
      commands: [],
      hashes: {},
    };
    // Only the settings the sim knows travel, so an unknown field of a caller never reaches a replay.
    const entropy = meta.options?.entropyPermillePerSecond;
    const creepCap = meta.options?.creepCapPerPlayer;
    if (entropy !== undefined || creepCap !== undefined) {
      this.replay.options = {
        ...(entropy === undefined ? {} : { entropyPermillePerSecond: entropy }),
        ...(creepCap === undefined ? {} : { creepCapPerPlayer: creepCap }),
      };
    }
  }

  /**
   * Call once per tick, after step(), with the commands that were fed in.
   * @param {import('./state.js').SimState} state
   * @param {import('./commands.js').CommandEnvelope[]} envelopes
   */
  record(state, envelopes) {
    for (const e of envelopes) this.replay.commands.push(structuredClone(e));
    this.replay.ticks = state.tick;
    if (state.tick % HASH_INTERVAL === 0) this.replay.hashes[String(state.tick)] = hashState(state);
  }
}

/**
 * Re-simulate a replay and compare hashes.
 * @param {Replay} replay
 * @param {import('./config.js').SimConfig} config
 * @returns {{ ok: boolean, firstMismatchTick: number | null, finalHash: string, state: import('./state.js').SimState }}
 */
export function playReplay(replay, config) {
  if (replay.specVersion !== SPEC_VERSION) {
    throw new Error(`replay specVersion ${replay.specVersion} != sim ${SPEC_VERSION}`);
  }
  const state = createState({ seed: replay.seed, players: replay.players, config });

  // Bucket commands by tick once; the log is already in record order.
  /** @type {import('./commands.js').CommandEnvelope[][]} */
  const byTick = [];
  for (const c of replay.commands) (byTick[c.tick] ??= []).push(c);

  let firstMismatchTick = null;
  while (state.tick < replay.ticks) {
    step(state, byTick[state.tick] ?? []);
    if (state.tick % HASH_INTERVAL === 0) {
      const expected = replay.hashes[String(state.tick)];
      if (expected !== undefined && expected !== hashState(state) && firstMismatchTick === null) {
        firstMismatchTick = state.tick;
      }
    }
  }
  return { ok: firstMismatchTick === null, firstMismatchTick, finalHash: hashState(state), state };
}
