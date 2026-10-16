import { Module } from '@nestjs/common';
import { PlayerStatsService } from './player-stats.service.js';
import { PlayersController } from './players.controller.js';
import { PlayersService } from './players.service.js';

@Module({
  controllers: [PlayersController],
  providers: [PlayersService, PlayerStatsService],
  exports: [PlayersService, PlayerStatsService],
})
export class PlayersModule {}
