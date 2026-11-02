import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import type { MatchLlmDto } from '../matches/dto/match.dto.js';
import { checkEndpoint, checkModel } from './llm-endpoint.js';

/** The settings one match's language model bot runs with. */
export interface LlmBotSettings {
  endpoint: string;
  model: string;
  /** True when the model drives both bots of a bot-versus-bot match. */
  bothSides: boolean;
  timeoutMs: number;
  thinkEveryTicks: number;
  maxTokens: number;
  temperature: number;
}

/**
 * The policy around the language model bot: whether this server offers one, and
 * which endpoint and model a match may name.
 *
 * It decides nothing about the game. The driver itself lives in the repo's
 * `src/llm/`, which `SimService` loads, and the match runner creates one bot per
 * team the settings name. This service exists so one place answers what a client
 * may ask for, and so `GET /api/game/spec` can tell both clients whether to
 * offer the switch at all.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly appConfig: ConfigService<AppConfig, true>) {}

  private get settings(): AppConfig['llm'] {
    return this.appConfig.get('llm', { infer: true });
  }

  /** Whether a match may ask a model to drive its bot on this server. */
  get available(): boolean {
    return this.settings.enabled;
  }

  /** What the clients prefill and show, and the limits they explain. */
  get advertised(): {
    available: boolean;
    defaultEndpoint: string;
    defaultModel: string;
    allowedHosts: string[];
    timeoutMs: number;
    thinkEveryTicks: number;
  } {
    const { enabled, defaultEndpoint, defaultModel, allowedHosts, timeoutMs, thinkEveryTicks } = this.settings;
    return { available: enabled, defaultEndpoint, defaultModel, allowedHosts: [...allowedHosts], timeoutMs, thinkEveryTicks };
  }

  /**
   * The settings of a match, or undefined when the match asks for no model.
   * Throws `BadRequestException` when the match asks for one this server refuses,
   * so the player reads the reason in the menu instead of watching a silent bot.
   */
  settingsFor(
    asked: { endpoint?: string; model?: string; bothSides?: boolean } | undefined,
    match: { vsBot?: boolean; botVsBot?: boolean },
  ): LlmBotSettings | undefined {
    if (!asked) return undefined;
    if (!this.available)
      throw new BadRequestException('This server runs no language model bot. Start it with LLM_BOT=on.');
    if (!match.vsBot && !match.botVsBot)
      throw new BadRequestException('A language model drives a bot, so set vsBot or botVsBot as well');

    const endpoint = checkEndpoint(asked.endpoint ?? this.settings.defaultEndpoint, this.settings.allowedHosts);
    if (!endpoint.ok) throw new BadRequestException(endpoint.reason);
    const model = checkModel(asked.model ?? this.settings.defaultModel);
    if (!model.ok) throw new BadRequestException(model.reason);

    return {
      endpoint: endpoint.endpoint as string,
      model: model.endpoint as string,
      bothSides: Boolean(asked.bothSides) && Boolean(match.botVsBot),
      timeoutMs: this.settings.timeoutMs,
      thinkEveryTicks: this.settings.thinkEveryTicks,
      maxTokens: this.settings.maxTokens,
      temperature: this.settings.temperature,
    };
  }

  /** The teams a model drives in a match, in team order. */
  teamsFor(settings: LlmBotSettings | undefined, botTeams: readonly number[]): number[] {
    if (!settings) return [];
    if (settings.bothSides) return [...botTeams];
    // One model plays the higher team, so a human keeps team 0 and a scripted bot keeps team 0 of a bot match.
    return botTeams.length > 0 ? [Math.max(...botTeams)] : [];
  }

  /** What the match record keeps and the lobby shows. The settings of the server stay out of it. */
  record(settings: LlmBotSettings | undefined): MatchLlmDto | undefined {
    if (!settings) return undefined;
    return { endpoint: settings.endpoint, model: settings.model, ...(settings.bothSides ? { bothSides: true } : {}) };
  }

  logStart(matchId: string, settings: LlmBotSettings, teams: readonly number[]): void {
    this.logger.log(
      `Match ${matchId}: ${settings.model} at ${settings.endpoint} drives team ${teams.join(' and ')}, one question every ${settings.thinkEveryTicks} ticks`,
    );
  }
}
