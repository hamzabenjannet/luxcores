import {
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
import { MatchDto } from '../matches/dto/match.dto.js';
import { MatchesService } from '../matches/matches.service.js';
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
    return this.runner.stop(id);
  }
}
