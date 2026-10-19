import { Controller, Get, NotFoundException, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { readdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { Public } from '../common/decorators/public.decorator.js';
import type { AppConfig } from '../config/configuration.js';
import { TestLinksDto } from './dto/test-links.dto.js';
import { LINKS, PAGES, PRESETS } from './test-catalog.js';

/** The addresses a phone on the same network can reach this server at. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

@ApiTags('dev')
@Controller('dev')
export class TestHubController {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  @Public()
  @Get('links')
  @ApiOperation({
    summary: 'Test pages, parameters and ready-made links',
    description:
      'Everything a person needs to try this build: the pages that take URL parameters (with each parameter described), links for the usual checks, and the addresses of this server, including the LAN addresses a phone can use. The page at `/tests` shows the same list. Returns 404 when `TEST_HUB` is off (the default in production).',
  })
  async links(@Req() req: Request): Promise<TestLinksDto> {
    if (!this.config.get('testHub', { infer: true })) throw new NotFoundException('The test hub is off');
    const here = new URL(`${req.protocol}://${req.get('host') ?? 'localhost'}`);
    const port = here.port ? `:${here.port}` : '';
    const origins = [{ label: 'This address', url: here.origin }];
    for (const ip of lanAddresses()) {
      const url = `http://${ip}${port}`;
      if (!origins.some((o) => o.url === url)) origins.push({ label: `LAN ${ip}`, url });
    }
    const root = this.config.get('game.repoRoot', { infer: true });
    const golden = (await readdir(join(root, 'replays', 'golden')).catch(() => [] as string[]))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => ({ group: 'Golden replays', title: f, description: 'A recorded match with a hash every 20 ticks, played by the determinism suite', path: `/replays/golden/${f}` }));
    return { origins, pages: PAGES, presets: PRESETS, links: [...LINKS, ...golden] };
  }
}
