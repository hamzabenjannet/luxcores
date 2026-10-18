import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import {
  configureApp,
  setupSwagger,
  startRabbitConsumer,
} from './app.setup.js';
import type { AppConfig } from './config/configuration.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const logger = new Logger('Bootstrap');

  configureApp(app);
  setupSwagger(app);
  app.useBodyParser('json', { limit: '5mb' }); // replays carry the whole command log

  if (!(await startRabbitConsumer(app))) {
    logger.log('No RabbitMQ consumer: domain events stay in this process');
  }

  const port = config.get('port', { infer: true });
  await app.listen(port, config.get('host', { infer: true }));
  logger.log(
    `Luxcores backend on http://localhost:${port}  (API docs: /api/docs)`,
  );
}

await bootstrap();
