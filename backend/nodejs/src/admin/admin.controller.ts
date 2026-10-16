import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ApiKeyGuard } from '../common/guards/api-key.guard.js';
import { COLLECTIONS, DataStore } from '../database/data-store.js';
import { MatchRunnerService } from '../game/match-runner.service.js';
import { ReplaysService } from '../replays/replays.service.js';

class StatsDto {
  @ApiProperty({ example: 12 }) players!: number;
  @ApiProperty({ example: 5 }) matches!: number;
  @ApiProperty({ example: 3 }) replays!: number;
  @ApiProperty({
    type: [String],
    description: 'Ids of matches that are ticking now',
  })
  runningMatches!: string[];
}

/**
 * Operator routes, guarded by the `x-api-key` header. `@Public()` only opens
 * the global JWT guard; `ApiKeyGuard` is the real check.
 */
@ApiTags('admin')
@ApiSecurity('api-key')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Missing or wrong x-api-key',
})
@Public()
@UseGuards(ApiKeyGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly store: DataStore,
    private readonly runner: MatchRunnerService,
    private readonly replays: ReplaysService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Counts of stored data and live matches' })
  @ApiOkResponse({ type: StatsDto })
  async stats(): Promise<StatsDto> {
    const [players, matches, replays] = await Promise.all([
      this.store.count(COLLECTIONS.players),
      this.store.count(COLLECTIONS.matches),
      this.store.count(COLLECTIONS.replays),
    ]);
    return {
      players,
      matches,
      replays,
      runningMatches: this.runner.runningMatchIds,
    };
  }

  @Delete('replays/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a replay' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async deleteReplay(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.replays.remove(id);
  }
}
