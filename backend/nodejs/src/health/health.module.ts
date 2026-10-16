import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { HealthController } from './health.controller.js';

@Module({ imports: [GameModule], controllers: [HealthController] })
export class HealthModule {}
