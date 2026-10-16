import { Module } from '@nestjs/common';
import { ReplaysController } from './replays.controller.js';
import { ReplaysService } from './replays.service.js';

@Module({
  controllers: [ReplaysController],
  providers: [ReplaysService],
  exports: [ReplaysService],
})
export class ReplaysModule {}
