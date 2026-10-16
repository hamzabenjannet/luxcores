import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPlayer } from '../common/decorators/current-player.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import type { AuthenticatedPlayer } from '../common/types.js';
import { PlayerDto } from './dto/player.dto.js';
import { PlayerListDto } from './dto/player-list.dto.js';
import { UpdatePlayerDto } from './dto/update-player.dto.js';
import { PlayersService } from './players.service.js';

@ApiTags('players')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Missing or invalid bearer token',
})
@Controller('players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  @ApiOperation({ summary: 'List players, newest first' })
  @ApiOkResponse({ type: PlayerListDto })
  list(@Query() query: PaginationQueryDto): Promise<PlayerListDto> {
    return this.players.list(query);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Top players by wins' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiOkResponse({ type: [PlayerDto] })
  leaderboard(@Query('limit') limit?: string): Promise<PlayerDto[]> {
    const n = Math.min(Math.max(Number(limit) || 10, 1), 100);
    return this.players.leaderboard(n);
  }

  @Get('me')
  @ApiOperation({ summary: 'The signed-in player' })
  @ApiOkResponse({ type: PlayerDto })
  me(@CurrentPlayer() player: AuthenticatedPlayer): Promise<PlayerDto> {
    return this.players.get(player.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Rename the signed-in player' })
  @ApiOkResponse({ type: PlayerDto })
  rename(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Body() dto: UpdatePlayerDto,
  ): Promise<PlayerDto> {
    return this.players.rename(player.id, dto.name);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One player by id' })
  @ApiOkResponse({ type: PlayerDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PlayerDto> {
    return this.players.get(id);
  }
}
