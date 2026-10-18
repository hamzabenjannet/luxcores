import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppConfig } from '../config/configuration.js';
import type {
  BotApi,
  SimApi,
  SimBot,
  SimMapLayout,
  SimPlayer,
  SimRecorder,
  SimReplay,
  SimState,
  WorldViewApi,
} from './sim.types.js';

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
    this.mapgenRaw = raw.mapgen;
    this.config = this.api.normalizeData(raw);
    this.logger.log(
      `Simulation spec ${this.specVersion} loaded from ${root}, data ${this.dataHash.slice(0, 8)}`,
    );
  }

  get specVersion(): string {
    return this.api.SPEC_VERSION;
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
      think: (state) =>
        bot.think(this.worldViewApi.localWorldView(state, team)),
    };
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
