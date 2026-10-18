import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { join } from 'node:path';
import type { AppConfig } from '../config/configuration.js';
import { Public } from '../common/decorators/public.decorator.js';

/**
 * The routes that live outside `/api`: the game page at `/`, the determinism
 * page, and an empty favicon so browsers do not log a 404 for it. Every other
 * static file comes from `StaticModule`.
 */
@ApiExcludeController()
@Public()
@Controller()
export class StaticController {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  @Get()
  index(@Res() res: Response): void {
    this.sendPage(res, 'index.html');
  }

  /** Plays the sim in the browser and prints the state hash, for the cross-engine check. */
  @Get('determinism.html')
  determinism(@Res() res: Response): void {
    this.sendPage(res, 'determinism.html');
  }

  private sendPage(res: Response, file: string): void {
    const page = join(this.config.get('game.repoRoot', { infer: true }), file);
    res.sendFile(page, (err) => {
      if (err && !res.headersSent)
        res
          .status(404)
          .json(new NotFoundException(`${file} not found`).getResponse());
    });
  }

  @Get('favicon.ico')
  @HttpCode(204)
  favicon(): void {}
}
