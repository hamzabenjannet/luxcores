import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { MAX_SEED, ParseSeedPipe } from '../common/pipes/parse-seed.pipe.js';
import { SimService } from '../simulation/sim.service.js';
import {
  GameSpecDto,
  type SocketDocDto,
  type WebSocketDocDto,
} from './dto/game-spec.dto.js';
import { MapLayoutDto } from './dto/map-layout.dto.js';
import {
  ChatMessageDto,
  GameCommandDto,
  MatchRefDto,
} from './dto/socket-dtos.js';

const SOCKET_DOC: SocketDocDto = {
  namespace: '/game',
  auth: 'Pass the JWT from POST /api/auth/guest as `auth: { token }` in the Socket.IO handshake.',
  events: [
    {
      name: 'match:join',
      direction: 'client-to-server',
      payload: 'MatchRefDto',
      description:
        'Join the match room. The ack holds the current snapshot, or null while the lobby is open.',
    },
    {
      name: 'match:leave',
      direction: 'client-to-server',
      payload: 'MatchRefDto',
      description: 'Leave the match room.',
    },
    {
      name: 'match:command',
      direction: 'client-to-server',
      payload: 'GameCommandDto',
      description:
        'Queue a sim command for the next tick. The ack is `{ accepted, tick?, reason? }`.',
    },
    {
      name: 'chat:message',
      direction: 'client-to-server',
      payload: 'ChatMessageDto',
      description: 'Send a chat line to everyone in the match room.',
    },
    {
      name: 'ping',
      direction: 'client-to-server',
      payload: 'none',
      description: 'The ack holds the server time.',
    },
    {
      name: 'match:updated',
      direction: 'server-to-client',
      payload: 'MatchDto',
      description: 'The lobby or the match status changed.',
    },
    {
      name: 'match:started',
      direction: 'server-to-client',
      payload: '{ matchId, tickHz, players, map, snapshot }',
      description:
        'The match began. `map` holds the lanes, vents and item spawns.',
    },
    {
      name: 'match:snapshot',
      direction: 'server-to-client',
      payload: 'MatchSnapshot',
      description:
        'World state every few ticks. `hash` appears every 20 ticks.',
    },
    {
      name: 'match:ended',
      direction: 'server-to-client',
      payload: '{ matchId, endedTick, result, replayId }',
      description: 'The match is over.',
    },
    {
      name: 'chat:message',
      direction: 'server-to-client',
      payload: '{ from, text, at }',
      description: 'A chat line from the room.',
    },
  ],
};

// The socket payload DTOs have no HTTP route, so list them here for the OpenAPI schemas.
const WEBSOCKET_DOC: WebSocketDocDto = {
  path: '/ws',
  format:
    'JSON frames { event, data, id? }. A frame with an id is answered by { event: "ack", id, data }.',
  auth: 'Authorization header, ?token= query parameter, or an auth frame { event: "auth", data: { token } } after connecting.',
  events: 'Same events as the Socket.IO namespace, listed in socket.events.',
};

@ApiExtraModels(MatchRefDto, GameCommandDto, ChatMessageDto)
@ApiTags('game')
@Controller('game')
export class GameController {
  constructor(
    private readonly sim: SimService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Get('spec')
  @ApiOperation({
    summary: 'Simulation spec and socket reference',
    description:
      'A client compares `specVersion` and `dataHash` with its own before it joins a match.',
  })
  @ApiOkResponse({ type: GameSpecDto })
  spec(): GameSpecDto {
    const game = this.config.get('game', { infer: true });
    return {
      specVersion: this.sim.specVersion,
      dataHash: this.sim.dataHash,
      mapgenVersion: this.sim.mapgenVersion,
      tickHz: this.sim.tickHz,
      snapshotEveryTicks: game.snapshotEveryTicks,
      matchMaxTicks: game.matchMaxTicks,
      kinds: this.sim.kinds,
      socket: SOCKET_DOC,
      webSocket: WEBSOCKET_DOC,
    };
  }

  @Public()
  @Get('maps/:seed')
  @ApiOperation({
    summary: 'The map for a seed',
    description:
      'The same layout `createState` builds, so a client can preview a lobby map.',
  })
  @ApiParam({
    name: 'seed',
    type: Number,
    example: 1234567,
    description: `A whole number from 0 to ${MAX_SEED}`,
  })
  @ApiOkResponse({ type: MapLayoutDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'The seed is not a whole number in range',
  })
  map(@Param('seed', ParseSeedPipe) seed: number): MapLayoutDto {
    return this.sim.generateMap(seed);
  }
}
