import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppConfig } from '../config/configuration.js';
import type { Fingerprint } from '../matchlog/match-event.js';
import type { ResumeAttempt } from '../matchlog/match-resume.js';
import type {
  BotApi,
  SimCommandEnvelope,
  SimApi,
  SimBot,
  SimMapLayout,
  SimPlayer,
  SimRecorder,
  SimReplay,
  SimState,
  WorldViewApi,
} from './sim.types.js';

/** Ticks that a rebuild runs before it lets other work in. */
const YIELD_EVERY = 200;

/**
 * Loads the repo's deterministic simulation (`src/sim`) and the game data
 * (`data/*.json`) once at startup, and wraps them for the rest of the server.
 *
 * The server never copies sim rules. It imports the same module the browser and
 * the tests run, so Node, Chromium and this server produce the same hashes
 * (`docs/TECH_ARCHITECTURE.md` section 13.1).
 */
@Injectable()
export class SimService {
  private readonly logger = new Logger(SimService.name);
  private api!: SimApi;
  private botApi!: BotApi;
  private worldViewApi!: WorldViewApi;
  private config!: ReturnType<SimApi['normalizeData']>;
  private mapgenRaw!: unknown;

  /** sha256 over the data files, computed the way `test/helpers/load-data.js` does. */
  dataHash!: string;
  /** sha256 over the sim, the bot and the world view: the code that decides what a match does. */
  codeHash!: string;

  constructor(private readonly appConfig: ConfigService<AppConfig, true>) {}

  /** Loads the sim and the data. `SimulationModule` calls it before any provider that needs the sim exists. */
  async load(): Promise<void> {
    const root = this.appConfig.get('game', { infer: true }).repoRoot;
    const entry = join(root, 'src', 'sim', 'index.js');
    try {
      await access(entry);
    } catch {
      throw new Error(
        `Cannot find the simulation at ${entry}. Set LUXCORES_ROOT to the Luxcores repo root.`,
      );
    }

    this.api = (await import(pathToFileURL(entry).href)) as SimApi;
    this.botApi = (await import(
      pathToFileURL(join(root, 'src', 'bot', 'bot.js')).href
    )) as BotApi;
    this.worldViewApi = (await import(
      pathToFileURL(join(root, 'src', 'shared', 'world-view.js')).href
    )) as WorldViewApi;
    const { DATA_FILES } = (await import(
      pathToFileURL(join(root, 'src', 'shared', 'data-files.js')).href
    )) as {
      DATA_FILES: Record<string, string>;
    };

    const raw: Record<string, unknown> = {};
    const sha = createHash('sha256');
    for (const [key, rel] of Object.entries(DATA_FILES)) {
      const text = await readFile(join(root, rel), 'utf8');
      sha.update(rel).update('\0').update(text).update('\0');
      raw[key] = JSON.parse(text);
    }
    this.dataHash = sha.digest('hex');
    this.codeHash = await hashCode(root);
    this.mapgenRaw = raw.mapgen;
    this.config = this.api.normalizeData(raw);
    this.logger.log(
      `Simulation spec ${this.specVersion} loaded from ${root}, data ${this.dataHash.slice(0, 8)}, code ${this.codeHash.slice(0, 8)}`,
    );
  }

  get specVersion(): string {
    return this.api.SPEC_VERSION;
  }

  /** The rules this server runs. A match log written under other rules cannot be replayed from the seed. */
  get fingerprint(): Fingerprint {
    return { specVersion: this.specVersion, dataHash: this.dataHash, codeHash: this.codeHash };
  }

  get tickHz(): number {
    return this.api.TICK_HZ;
  }

  /** Ticks after which an undecided match ends as a draw (`match.stalemateTicks` in data/balance.json). */
  get stalemateTicks(): number {
    return (this.config.balance as { match: { stalemateTicks: number } }).match.stalemateTicks;
  }

  /** Entity kind codes by name (`CORE`, `SOLAR`, `TOWER`, `HERO` ...), so clients need not hard-code them. */
  get kinds(): Record<string, number> {
    return { ...this.api.KIND };
  }

  get hashInterval(): number {
    return this.api.HASH_INTERVAL;
  }

  get mapgenVersion(): number {
    return this.config.mapgen.version;
  }

  /** A fresh match and the recorder that logs it. */
  createMatch(
    seed: number,
    players: SimPlayer[],
  ): { state: SimState; recorder: SimRecorder } {
    const state = this.api.createState({ seed, players, config: this.config });
    const recorder = new this.api.Recorder({
      seed,
      players,
      dataHash: this.dataHash,
      mapgenVersion: this.mapgenVersion,
    });
    return { state, recorder };
  }

  /** A bot for one player. Its commands are ordinary envelopes, so the replay holds them like a human's. */
  createBot(playerId: number, team: number, seed: number): SimBot {
    const bot = this.botApi.createBot({
      playerId,
      team,
      config: this.config,
      seed,
    });
    return {
      playerId,
      think: (state) =>
        bot.think(this.worldViewApi.localWorldView(state, team)),
      save: () => bot.saveState(),
      load: (memory) => bot.loadState(memory),
    };
  }

  /** The state and the bots' memory as plain data. The runner logs it as a checkpoint. */
  exportState(state: SimState, bots: SimBot[]): { state: Record<string, unknown>; bots: { playerId: number; memory: unknown }[] } {
    return {
      state: this.api.exportState(state),
      bots: bots.map((bot) => ({ playerId: bot.playerId, memory: bot.save() })),
    };
  }

  /**
   * Rebuilds a running match from one attempt of its resume plan, up to `targetTick`: from a checkpoint
   * (the saved state and the bots' memory) or from the seed, then the logged commands tick by tick. The
   * bots think on every tick as they did live, so their own state (build rotation, counters, random
   * numbers) ends up where it was.
   *
   * A strict attempt throws when the sim disagrees with the log: a bot that would issue other commands,
   * a state hash that differs, or a checkpoint that does not hash to its saved value. A lenient attempt
   * (the rules changed since the log was written) applies the logged commands under the current rules
   * and checks nothing, because the numbers cannot match any more.
   *
   * It yields to the event loop every `YIELD_EVERY` ticks, so rebuilding a long match does not stall
   * the matches that run.
   */
  async rebuild(opts: {
    seed: number;
    /** The rules the match began under, kept in the replay header. */
    began: { dataHash: string; mapgenVersion: number };
    players: SimPlayer[];
    bots: SimBot[];
    attempt: ResumeAttempt;
    targetTick: number;
  }): Promise<{ state: SimState; recorder: SimRecorder }> {
    const { attempt } = opts;
    const { checkpoint } = attempt;
    let state: SimState;
    if (checkpoint) {
      state = this.api.importState(checkpoint.state, this.config);
      if (attempt.strict && this.hash(state) !== checkpoint.hash) {
        throw new Error(`The checkpoint at tick ${checkpoint.tick} does not hash to its saved value`);
      }
      for (const bot of opts.bots) {
        const saved = checkpoint.bots.find((b) => b.playerId === bot.playerId);
        if (saved) bot.load(saved.memory);
      }
    } else {
      state = this.api.createState({ seed: opts.seed, players: opts.players, config: this.config });
    }
    const recorder = new this.api.Recorder({
      seed: opts.seed,
      players: opts.players,
      dataHash: opts.began.dataHash,
      mapgenVersion: opts.began.mapgenVersion,
    });
    recorder.replay.commands.push(...attempt.before.commands);
    Object.assign(recorder.replay.hashes, attempt.before.hashes);
    recorder.replay.ticks = state.tick;

    const byTick = new Map<number, SimCommandEnvelope[]>();
    for (const e of attempt.commands) {
      const list = byTick.get(e.tick);
      if (list) list.push(e);
      else byTick.set(e.tick, [e]);
    }
    const botIds = new Set(opts.bots.map((bot) => bot.playerId));
    const brief = (list: SimCommandEnvelope[]): string =>
      JSON.stringify(
        list
          .map((e) => ({ p: e.playerId, s: e.seq, c: e.cmd }))
          .sort((a, b) => a.p - b.p || a.s - b.s),
      );
    let sinceYield = 0;
    while (state.tick < opts.targetTick && !state.outcome) {
      const logged = byTick.get(state.tick) ?? [];
      const regenerated = opts.bots.flatMap((bot) => bot.think(state));
      if (attempt.strict) {
        const loggedBots = logged.filter((e) => botIds.has(e.playerId));
        if (brief(regenerated) !== brief(loggedBots)) {
          throw new Error(
            `A bot would issue other commands at tick ${state.tick} than the log holds`,
          );
        }
      }
      this.step(state, logged);
      recorder.record(state, logged);
      const expected = attempt.hashes[state.tick];
      if (attempt.strict && expected !== undefined && expected !== this.hash(state)) {
        throw new Error(`The state hash differs from the log at tick ${state.tick}`);
      }
      if (++sinceYield >= YIELD_EVERY) {
        sinceYield = 0;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    return { state, recorder };
  }

  step: SimApi['step'] = (state, envelopes) => this.api.step(state, envelopes);

  hash(state: SimState): string {
    return this.api.hashState(state);
  }

  /** The map for a seed, as `createState` would build it. Takes about 0.4 ms. */
  generateMap(seed: number): SimMapLayout {
    return this.api.generateMap(seed, this.config.mapgen);
  }

  /** Raw (unconverted) `data/mapgen.json`, for clients that draw the map. */
  get mapgenData(): unknown {
    return this.mapgenRaw;
  }

  playReplay(replay: SimReplay): ReturnType<SimApi['playReplay']> {
    return this.api.playReplay(replay, this.config);
  }
}

/** sha256 over every file that decides what a match does, in a fixed order. */
async function hashCode(root: string): Promise<string> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.js')) files.push(path);
    }
  };
  await walk(join(root, 'src', 'sim'));
  files.push(join(root, 'src', 'bot', 'bot.js'), join(root, 'src', 'shared', 'world-view.js'));
  const sha = createHash('sha256');
  for (const file of files) sha.update(file.slice(root.length)).update('\0').update(await readFile(file)).update('\0');
  return sha.digest('hex');
}
