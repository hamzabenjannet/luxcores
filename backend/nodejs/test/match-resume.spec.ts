import { describe, expect, it } from 'vitest';
import type { Checkpoint, Fingerprint, MatchEvent } from '../src/matchlog/match-event.js';
import { planResume } from '../src/matchlog/match-resume.js';

const A: Fingerprint = { specVersion: '0.10.0', dataHash: 'data-a', codeHash: 'code-a' };
const B: Fingerprint = { specVersion: '0.10.0', dataHash: 'data-b', codeHash: 'code-a' };
const PLAYERS = [
  { playerId: 'p', simId: 0, name: 'P', team: 0, kind: 'human' as const },
  { simId: 1, name: 'Bot', team: 1, kind: 'bot' as const },
];

let seq = 0;
const at = (n: number) => {
  seq = n;
};
const base = (type: string, tick: number, data: unknown) => ({ matchId: 'm', seq: seq++, tick, type, data }) as unknown as MatchEvent;
const started = (rules: Fingerprint) => base('started', 0, { ...rules, seed: 7, players: PLAYERS, mapgenVersion: 1 });
const command = (tick: number, playerId: number, n: number) => base('command', tick, { playerId, seq: n, cmd: { t: 'noop' } });
const hash = (tick: number) => base('hash', tick, { hash: `h${tick}` });
const resumed = (tick: number, rules: Fingerprint) => base('resumed', tick, { ...rules, at: 'now', mode: 'checkpoint' });
const checkpoint = (tick: number, nextSeq: number): Checkpoint => ({ matchId: 'm', seq: nextSeq, tick, hash: `h${tick}`, state: {}, bots: [] });

function log(rules: Fingerprint): MatchEvent[] {
  at(0);
  return [started(rules), command(0, 0, 0), command(3, 1, 0), hash(20), command(25, 0, 1), hash(40), command(41, 0, 2)];
}

describe('planResume', () => {
  it('returns nothing for a log with no start event', () => {
    at(0);
    expect(planResume([hash(20)], [], A)).toBeNull();
  });

  it('reads the target tick, the next sequence number of each human and the end', () => {
    const plan = planResume(log(A), [], A);
    expect(plan).toMatchObject({ seed: 7, target: 42, reproducible: true });
    expect([...(plan?.lastSeq ?? [])]).toEqual([[0, 2]]); // the bot's counter is not a human's
    expect(plan?.finished).toBeUndefined();
  });

  it('tries the newest checkpoint first, then older ones, then the seed', () => {
    const events = log(A);
    const plan = planResume(events, [checkpoint(20, 4), checkpoint(40, 6)], A);
    expect(plan?.attempts.map((a) => a.checkpoint?.tick)).toEqual([40, 20, undefined]);
    expect(plan?.attempts.every((a) => a.strict)).toBe(true);
  });

  it('splits the commands and hashes at the checkpoint', () => {
    const events = log(A); // seq: 0 started, 1-2 commands, 3 hash 20, 4 command 25, 5 hash 40, 6 command 41
    const attempt = planResume(events, [checkpoint(20, 4)], A)?.attempts[0];
    expect(attempt?.before.commands.map((c) => c.tick)).toEqual([0, 3]);
    expect(attempt?.before.hashes).toEqual({ '20': 'h20' });
    expect(attempt?.commands.map((c) => c.tick)).toEqual([25, 41]);
    expect(attempt?.hashes).toEqual({ 40: 'h40' });
  });

  it('ignores a checkpoint that is ahead of its log, because events before it were lost', () => {
    const plan = planResume(log(A), [checkpoint(60, 30)], A);
    expect(plan?.attempts.map((a) => a.checkpoint)).toEqual([undefined]);
  });

  it('under changed rules offers only checkpoints, never a replay from the seed, and marks the match unreproducible', () => {
    const plan = planResume(log(A), [checkpoint(20, 4)], B);
    expect(plan?.attempts).toHaveLength(1);
    expect(plan?.attempts[0]).toMatchObject({ strict: false });
    expect(plan?.reproducible).toBe(false);
    expect(planResume(log(A), [], B)?.attempts).toEqual([]);
  });

  it('treats a log without a code hash as written by the current code', () => {
    const old: Fingerprint = { specVersion: '0.10.0', dataHash: 'data-a' };
    const plan = planResume(log(old), [], A);
    expect(plan?.attempts.map((a) => a.strict)).toEqual([true]);
  });

  it('is strict again once a later resume and its checkpoint ran under the current rules', () => {
    at(0);
    const events = [started(A), command(0, 0, 0), hash(20), resumed(21, B), command(30, 0, 1), hash(40)];
    // A checkpoint written before the change (seq 3 is the resumed event) is a product of the old rules.
    const old = checkpoint(20, 3);
    // A checkpoint written after it (seq 4 or later) is a product of the new rules.
    const fresh = checkpoint(30, 5);
    const plan = planResume(events, [old, fresh], B);
    expect(plan?.attempts.map((a) => [a.checkpoint?.tick, a.strict])).toEqual([
      [30, true],
      [20, false],
    ]);
    expect(plan?.reproducible, 'the match ran under two rule sets').toBe(false);
  });

  it('reports a finished match and its end tick', () => {
    at(0);
    const events = [started(A), command(0, 0, 0), base('finished', 90, { result: { draw: true }, endedTick: 90 })];
    const plan = planResume(events, [], A);
    expect(plan?.finished).toBeDefined();
    expect(plan?.target).toBe(90);
  });
});
