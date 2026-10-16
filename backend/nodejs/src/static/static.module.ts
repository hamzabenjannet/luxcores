import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import type { AppConfig } from '../config/configuration.js';
import { StaticController } from './static.controller.js';

/**
 * Static file routes, outside the `/api` prefix:
 *
 *   /            the game page (`index.html`, see StaticController)
 *   /src/**      client and sim modules of the game
 *   /data/**     game data (`data/*.json`)
 *   /assets/**   models and textures
 *   /public/**   files that belong to the backend itself (`backend/nodejs/public`)
 *
 * The game folders come from the Luxcores repo root (`LUXCORES_ROOT`). Each one
 * is mounted on its own, so the repo root, `.git` and `backend/` stay unreachable.
 */
@Module({
  imports: [
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const root = config.get('game.repoRoot', { infer: true });
        const options = { index: false, dotfiles: 'ignore', maxAge: 0 };
        return [
          {
            rootPath: join(root, 'src'),
            serveRoot: '/src',
            serveStaticOptions: options,
          },
          {
            rootPath: join(root, 'data'),
            serveRoot: '/data',
            serveStaticOptions: options,
          },
          {
            rootPath: join(root, 'assets'),
            serveRoot: '/assets',
            serveStaticOptions: options,
          },
          {
            rootPath: config.get('static.publicDir', { infer: true }),
            serveRoot: '/public',
            serveStaticOptions: options,
          },
        ];
      },
    }),
  ],
  controllers: [StaticController],
})
export class StaticModule {}
