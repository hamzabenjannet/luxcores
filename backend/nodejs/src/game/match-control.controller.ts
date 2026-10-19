import {
  ConflictException,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPlayer } from '../common/decorators/current-player.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import type { AuthenticatedPlayer } from '../common/types.js';
import { MatchDto, MatchStatus } from '../matches/dto/match.dto.js';
import { MatchesService } from '../matches/matches.service.js';
import { ClusterService } from '../cluster/cluster.service.js';
import { MatchRunnerService } from './match-runner.service.js';

@ApiTags('matches')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Missing or invalid bearer token',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'Only the host can do this',
})
@Controller('matches')
export class MatchControlController {
  constructor(
    private readonly matches: MatchesService,
    private readonly runner: MatchRunnerService,
    private readonly cluster: ClusterService,
  ) {}

  @Post(':id/start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start the match',
    description:
      'Host only. Needs two players, or a bot match. The server then simulates at 20 Hz. Clients join the room with the `match:join` socket event.',
  })
  @ApiOkResponse({ type: MatchDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Waiting for a second player, or the match already started',
  })
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlayer() player: AuthenticatedPlayer,
  ): Promise<MatchDto> {
    return this.runner.start(await this.matches.requireHost(id, player));
  }

  @Post(':id/stop')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stop a running match',
    description:
      'Host only. The replay up to this tick is kept and the match counts as a draw.',
  })
  @ApiOkResponse({ type: MatchDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The match is not running',
  })
  async stop(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlayer() player: AuthenticatedPlayer,
  ): Promise<MatchDto> {
    await this.matches.requireHost(id, player);
    return this.cluster.stop(id);
  }

  @Post(':id/quit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Leave a running match',
    description:
      'For a player of the match, or the host of a bot-versus-bot match. In a match for two humans the leaver forfeits: the other team wins with the reason `forfeit`. Against a bot, or alone, the match stops as a draw. The replay up to this tick is kept. Leave an open lobby with `POST /matches/{id}/leave`.',
  })
  @ApiOkResponse({ type: MatchDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The match is not running, or you are not in it',
  })
  async quit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlayer() player: AuthenticatedPlayer,
  ): Promise<MatchDto> {
    const match = await this.matches.get(id);
    if (match.status !== MatchStatus.Running) throw new ConflictException('The match is not running');
    const me = match.players.find((p) => p.playerId === player.id);
    if (!me && !(match.botVsBot && match.hostId === player.id)) throw new ConflictException('You are not in this match');
    const humans = match.players.filter((p) => p.kind === 'human');
    // Nobody else plays: there is no one to win, so the match just stops.
    if (!me || humans.length < 2) return this.cluster.stop(id);
    return this.cluster.forfeit(id, me.team);
  }
}
