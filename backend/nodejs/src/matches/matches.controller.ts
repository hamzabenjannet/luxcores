import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPlayer } from '../common/decorators/current-player.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import type { AuthenticatedPlayer } from '../common/types.js';
import { CreateMatchDto } from './dto/create-match.dto.js';
import { ListMatchesQueryDto } from './dto/list-matches-query.dto.js';
import { MatchListDto } from './dto/match-list.dto.js';
import { MatchDto } from './dto/match.dto.js';
import { MatchesService } from './matches.service.js';

@ApiTags('matches')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Missing or invalid bearer token',
})
@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Post()
  @ApiOperation({
    summary: 'Open a lobby',
    description: 'The caller becomes the host and takes team 0.',
  })
  @ApiCreatedResponse({ type: MatchDto })
  create(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Body() dto: CreateMatchDto,
  ): Promise<MatchDto> {
    return this.matches.create(player, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List matches, newest first' })
  @ApiOkResponse({ type: MatchListDto })
  list(@Query() query: ListMatchesQueryDto): Promise<MatchListDto> {
    return this.matches.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One match by id' })
  @ApiOkResponse({ type: MatchDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<MatchDto> {
    return this.matches.get(id);
  }

  @Post(':id/join')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Join an open lobby',
    description: 'Takes the first free team. Joining twice changes nothing.',
  })
  @ApiOkResponse({ type: MatchDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The match is full, closed or against a bot',
  })
  join(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlayer() player: AuthenticatedPlayer,
  ): Promise<MatchDto> {
    return this.matches.join(id, player);
  }

  @Post(':id/leave')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Leave a lobby',
    description: 'When the host leaves, the lobby is cancelled.',
  })
  @ApiOkResponse({ type: MatchDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  leave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlayer() player: AuthenticatedPlayer,
  ): Promise<MatchDto> {
    return this.matches.leave(id, player);
  }
}
