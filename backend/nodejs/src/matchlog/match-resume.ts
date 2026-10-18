import type { SimCommandEnvelope } from '../simulation/sim.types.js';
import type {
  Checkpoint,
  Fingerprint,
  FinishedEvent,
  LoggedPlayer,
  MatchEvent,
  StartedEvent,
} from './match-event.js';

/** One way to rebuild the match: from a checkpoint or from the seed. */
export interface ResumeAttempt {
  /** Absent when the rebuild starts from the seed. */
  checkpoint?: Checkpoint;
  /**
   * True when the rules that wrote every event from the start point on equal the current ones.
   * A strict rebuild must reproduce the logged hashes and bot commands. Otherwise it applies the logged
   * commands under the current rules and checks nothing.
   */
  strict: boolean;
  /** Commands to feed to the sim from the start point on, in log order. */
  commands: SimCommandEnvelope[];
  /** Logged hashes to check from the start point on, by tick. */
  hashes: Record<number, string>;
  /** What the replay already holds before the start point. */
  before: { commands: SimCommandEnvelope[]; hashes: Record<string, string> };
}

/** Everything the log says about a match that stopped running, ready to rebuild. */
export interface ResumePlan {
  started: StartedEvent;
  seed: number;
  players: LoggedPlayer[];
  finished?: FinishedEvent;
  /** The last tick the log reaches. The rebuilt match stands here. */
  target: number;
  /** The next sequence number of each human player, from the logged commands. */
  lastSeq: Map<number, number>;
  /** Best first: the newest checkpoint, older ones, then the seed. */
  attempts: ResumeAttempt[];
  /** True when the whole match so far ran under the current rules, so its replay verifies from the seed. */
  reproducible: boolean;
}

const sameRules = (a: Fingerprint, b: Fingerprint): boolean =>
  a.specVersion === b.specVersion &&
  a.dataHash === b.dataHash &&
  // A log from before checkpoints has no code hash. Assume it ran this code.
  (a.codeHash === undefined || b.codeHash === undefined || a.codeHash === b.codeHash);

/**
 * Reads a match log and lists the ways to rebuild the match, best first. Never throws on a
 * damaged log: it returns no attempt, and the caller gives the match up.
 */
export function planResume(events: MatchEvent[], checkpoints: Checkpoint[], current: Fingerprint): ResumePlan | null {
  const started = events.find((e): e is StartedEvent => e.type === 'started');
  if (!started) return null;
  const finished = events.find((e): e is FinishedEvent => e.type === 'finished');

  const epochs: { seq: number; rules: Fingerprint }[] = [{ seq: started.seq, rules: started.data }];
  for (const e of events) if (e.type === 'resumed') epochs.push({ seq: e.seq, rules: e.data });

  let target = 0;
  const lastSeq = new Map<number, number>();
  const humans = new Set(started.data.players.filter((p) => p.kind === 'human').map((p) => p.simId));
  for (const e of events) {
    if (e.type === 'command') {
      target = Math.max(target, e.tick + 1);
      if (humans.has(e.data.playerId)) lastSeq.set(e.data.playerId, Math.max(lastSeq.get(e.data.playerId) ?? -1, e.data.seq));
    } else if (e.type === 'hash') target = Math.max(target, e.tick);
    else if (e.type === 'finished') target = Math.max(target, e.data.endedTick);
  }

  /**
   * True when the current rules wrote the checkpoint and every event after it. A checkpoint sits before
   * the event numbered `seq`, so the rules that wrote it are those of the last epoch that began before `seq`.
   */
  const strictFrom = (checkpoint: Checkpoint | undefined): boolean => {
    const first = checkpoint ? Math.max(epochs.filter((e) => e.seq < checkpoint.seq).length - 1, 0) : 0;
    return epochs.slice(first).every((e) => sameRules(e.rules, current));
  };

  const attemptFrom = (checkpoint: Checkpoint | undefined): ResumeAttempt => {
    const from = checkpoint?.seq ?? 0;
    const attempt: ResumeAttempt = {
      checkpoint,
      strict: strictFrom(checkpoint),
      commands: [],
      hashes: {},
      before: { commands: [], hashes: {} },
    };
    for (const e of events) {
      const later = e.seq >= from;
      if (e.type === 'command') {
        const envelope = { tick: e.tick, playerId: e.data.playerId, seq: e.data.seq, cmd: e.data.cmd };
        (later ? attempt.commands : attempt.before.commands).push(envelope);
      } else if (e.type === 'hash') {
        if (later) attempt.hashes[e.tick] = e.data.hash;
        else attempt.before.hashes[String(e.tick)] = e.data.hash;
      }
    }
    return attempt;
  };

  const attempts: ResumeAttempt[] = checkpoints
    .filter((cp) => cp.seq <= events.length && cp.tick <= target) // a checkpoint ahead of its log lost events and cannot be placed
    .sort((a, b) => b.seq - a.seq)
    .map(attemptFrom);
  const fromSeed = attemptFrom(undefined);
  if (fromSeed.strict) attempts.push(fromSeed); // under changed rules a replay from the seed would rewrite the match

  return {
    started,
    seed: started.data.seed,
    players: started.data.players,
    finished,
    target,
    lastSeq,
    attempts,
    reproducible: epochs.every((e) => sameRules(e.rules, current)),
  };
}
