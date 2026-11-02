import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/configuration.js';
import { checkEndpoint, checkModel } from '../src/llm/llm-endpoint.js';
import { LlmService } from '../src/llm/llm.service.js';

const LOOPBACK = ['localhost', '127.0.0.1', '::1'];

/** A `LlmService` over the settings one case needs, without the whole Nest container. */
function service(llm: Partial<AppConfig['llm']> = {}): LlmService {
  const settings: AppConfig['llm'] = {
    enabled: true,
    allowedHosts: LOOPBACK,
    defaultEndpoint: 'http://localhost:11434',
    defaultModel: 'qwen2.5:3b',
    timeoutMs: 20_000,
    thinkEveryTicks: 40,
    maxTokens: 512,
    temperature: 0,
    ...llm,
  };
  return new LlmService({ get: () => settings } as never);
}

describe('the endpoint policy', () => {
  it('accepts a loopback address with or without a trailing slash or /api', () => {
    for (const value of ['http://localhost:11434', 'http://localhost:11434/', 'http://localhost:11434/api', ' http://127.0.0.1:11434 ']) {
      const check = checkEndpoint(value, LOOPBACK);
      expect(check.ok, value).toBe(true);
      expect(check.endpoint).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):11434$/);
    }
    expect(checkEndpoint('http://[::1]:11434', LOOPBACK).ok).toBe(true);
  });

  it('refuses a host the allowlist does not hold, and takes any host when it holds a star', () => {
    const refused = checkEndpoint('http://ollama.example.com:11434', LOOPBACK);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('LLM_ALLOWED_HOSTS');
    expect(checkEndpoint('http://ollama.example.com:11434', ['*']).ok).toBe(true);
    expect(checkEndpoint('http://10.0.0.5:11434', ['10.0.0.5']).ok).toBe(true);
  });

  it('refuses everything that is no plain http host and port', () => {
    const cases: [unknown, RegExp][] = [
      ['', /missing/],
      [undefined, /missing/],
      [42, /missing/],
      // `localhost:11434` parses as a URL whose scheme is `localhost:`, so the scheme rule catches it.
      ['localhost:11434', /must start with http/],
      ['file:///etc/passwd', /http/],
      ['ftp://localhost:11434', /http/],
      ['http://user:secret@localhost:11434', /user name or password/],
      ['http://localhost:11434/api/chat', /not the path/],
      ['http://localhost:11434/?x=1', /no query/],
      [`http://localhost:11434/${'a'.repeat(300)}`, /longer than 200/],
    ];
    for (const [value, reason] of cases) {
      const check = checkEndpoint(value, LOOPBACK);
      expect(check.ok, String(value)).toBe(false);
      expect(check.reason, String(value)).toMatch(reason);
    }
  });

  it('accepts a model name Ollama could hold and refuses the rest', () => {
    for (const model of ['qwen2.5:3b', 'llama3.1', 'library/mistral:7b-instruct', 'a']) {
      expect(checkModel(model).ok, model).toBe(true);
    }
    for (const model of ['', ' ', ':3b', 'model name', 'qwen;rm -rf /', 'q'.repeat(90)]) {
      expect(checkModel(model).ok, JSON.stringify(model)).toBe(false);
    }
  });
});

describe('the language model bot policy', () => {
  it('leaves a match without the field on the scripted bot', () => {
    expect(service().settingsFor(undefined, { vsBot: true })).toBeUndefined();
    expect(service().record(undefined)).toBeUndefined();
    expect(service().teamsFor(undefined, [1])).toEqual([]);
  });

  it('fills the endpoint and the model from the server settings', () => {
    const settings = service().settingsFor({}, { vsBot: true });
    expect(settings).toMatchObject({ endpoint: 'http://localhost:11434', model: 'qwen2.5:3b', bothSides: false, thinkEveryTicks: 40 });
  });

  it('refuses a model when the server runs none, when no bot plays, and when the host is not allowed', () => {
    expect(() => service({ enabled: false }).settingsFor({}, { vsBot: true })).toThrow(BadRequestException);
    expect(() => service().settingsFor({}, {})).toThrow(/vsBot or botVsBot/);
    expect(() => service().settingsFor({ endpoint: 'http://evil.example.com:11434' }, { vsBot: true })).toThrow(/evil\.example\.com/);
    expect(() => service().settingsFor({ model: 'not a model' }, { vsBot: true })).toThrow(/no model name/);
  });

  it('drives the second bot of a match, and both only when a bot match asks for it', () => {
    const one = service().settingsFor({}, { vsBot: true });
    expect(service().teamsFor(one, [1])).toEqual([1]);
    const bots = service().settingsFor({ bothSides: true }, { botVsBot: true });
    expect(service().teamsFor(bots, [0, 1])).toEqual([0, 1]);
    // `bothSides` means nothing in a match against a human, so one bot stays scripted.
    const human = service().settingsFor({ bothSides: true }, { vsBot: true });
    expect(human?.bothSides).toBe(false);
    expect(service().teamsFor(service().settingsFor({}, { botVsBot: true }), [0, 1])).toEqual([1]);
  });

  it('records the endpoint and the model of a match and nothing else', () => {
    const settings = service().settingsFor({ endpoint: 'http://127.0.0.1:11434/', model: 'llama3.1', bothSides: true }, { botVsBot: true });
    expect(service().record(settings)).toEqual({ endpoint: 'http://127.0.0.1:11434', model: 'llama3.1', bothSides: true });
  });

  it('tells the clients what to offer', () => {
    expect(service().advertised).toEqual({
      available: true,
      defaultEndpoint: 'http://localhost:11434',
      defaultModel: 'qwen2.5:3b',
      allowedHosts: LOOPBACK,
      timeoutMs: 20_000,
      thinkEveryTicks: 40,
    });
    expect(service({ enabled: false }).advertised.available).toBe(false);
  });
});
