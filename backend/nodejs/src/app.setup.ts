import {
  type INestApplication,
  Logger,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import type { AppConfig } from './config/configuration.js';
import { assertBrokerReachable } from './events/rabbitmq-event-bus.js';
import { APP_VERSION } from './version.js';

/**
 * Settings that `main.ts` and the end-to-end tests share, so a test exercises the
 * same prefix, pipes and filters as production.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const origin = config.get('corsOrigin', { infer: true });

  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: 'favicon.ico', method: RequestMethod.GET },
    ],
  });
  app.enableCors({
    origin: origin === '*' ? true : origin.split(',').map((o) => o.trim()),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}

/** OpenAPI document at `/api/docs` (UI) and `/api/docs-json` (raw). */
export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Luxcores Backend')
      .setDescription(
        'REST API and Socket.IO match server for Luxcores multiplayer. The server runs the deterministic sim of the repo (`src/sim`) at 20 Hz and streams snapshots. The Socket.IO events are listed under `GET /api/game/spec`.',
      )
      .setVersion(APP_VERSION)
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .addTag('auth', 'Guest sign-in')
      .addTag('players', 'Profiles and the leaderboard')
      .addTag('matches', 'Lobbies, start and stop')
      .addTag('game', 'Sim spec, maps and the socket reference')
      .addTag('replays', 'Upload, list and verify replays')
      .addTag('admin', 'Operator routes (x-api-key)')
      .addTag('health', 'Liveness')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'Luxcores API',
  });
}

/**
 * Attaches the RabbitMQ consumer when `RABBITMQ_URL` is set. Returns whether it did.
 * The publisher side lives in `EventsModule`; this is the matching consumer for
 * `EventsController`.
 */
export async function startRabbitConsumer(
  app: INestApplication,
): Promise<boolean> {
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const rabbit = config.get('rabbitmq', { infer: true });
  if (!rabbit.url) return false;
  await assertBrokerReachable(rabbit.url); // fail fast; Nest's consumer would retry for ever
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [rabbit.url],
        queue: rabbit.queue,
        queueOptions: { durable: true },
        noAck: false,
        prefetchCount: rabbit.prefetch,
      },
    },
    { inheritAppConfig: true },
  );
  await app.startAllMicroservices();
  new Logger('Bootstrap').log(`RabbitMQ consumer on queue "${rabbit.queue}"`);
  return true;
}
