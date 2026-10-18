import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClusterService } from '../cluster/cluster.service.js';
import { MatchesModule } from '../matches/matches.module.js';
import { ReplaysModule } from '../replays/replays.module.js';
import { GameController } from './game.controller.js';
import { GameActions } from './game-actions.service.js';
import { GameGateway } from './game.gateway.js';
import { MatchControlController } from './match-control.controller.js';
import { MatchRunnerService } from './match-runner.service.js';
import { RawWsGateway } from './raw-ws.gateway.js';
import { RoomHub } from './room-hub.service.js';
import { WsJwtGuard } from './ws-jwt.guard.js';

@Module({
  imports: [AuthModule, MatchesModule, ReplaysModule],
  controllers: [GameController, MatchControlController],
  providers: [
    MatchRunnerService,
    ClusterService,
    GameActions,
    RoomHub,
    GameGateway,
    RawWsGateway,
    WsJwtGuard,
  ],
  exports: [MatchRunnerService, ClusterService],
})
export class GameModule {}
