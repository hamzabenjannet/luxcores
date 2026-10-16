import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { ReplaysModule } from '../replays/replays.module.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [GameModule, ReplaysModule],
  controllers: [AdminController],
})
export class AdminModule {}
