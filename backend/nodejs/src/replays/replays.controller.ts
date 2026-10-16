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
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentPlayer } from '../common/decorators/current-player.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import type { AuthenticatedPlayer } from '../common/types.js';
import {
  ReplayListDto,
  ReplayRecordDto,
  ReplayVerifyResultDto,
} from './dto/replay-record.dto.js';
import { UploadReplayDto } from './dto/upload-replay.dto.js';
import { ReplaysService } from './replays.service.js';

@ApiTags('replays')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Missing or invalid bearer token',
})
@Controller('replays')
export class ReplaysController {
  constructor(private readonly replays: ReplaysService) {}

  @Post()
  @ApiOperation({
    summary: 'Upload a replay',
    description:
      'Stores the replay as given. Use the verify route to check it.',
  })
  @ApiCreatedResponse({ type: ReplayRecordDto })
  upload(
    @CurrentPlayer() player: AuthenticatedPlayer,
    @Body() dto: UploadReplayDto,
  ): Promise<ReplayRecordDto> {
    return this.replays.upload(player.id, dto.replay, dto.matchId);
  }

  @Get()
  @ApiOperation({ summary: 'List replays without their payload, newest first' })
  @ApiOkResponse({ type: ReplayListDto })
  list(@Query() query: PaginationQueryDto): Promise<ReplayListDto> {
    return this.replays.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One replay with its payload' })
  @ApiOkResponse({ type: ReplayRecordDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ReplayRecordDto> {
    return this.replays.get(id);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Re-simulate a replay',
    description:
      'Runs the replay through the server simulation and compares every recorded hash.',
  })
  @ApiOkResponse({ type: ReplayVerifyResultDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'The replay predates this spec version or is malformed',
  })
  verify(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReplayVerifyResultDto> {
    return this.replays.verify(id);
  }
}
