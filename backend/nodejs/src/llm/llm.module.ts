import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service.js';

/**
 * The language model bot as its own part of the server. It holds the policy
 * only: the match runner and the matches service ask it what a match may use,
 * and the driver itself stays in the repo's `src/llm/`, which `SimService`
 * loads. Nothing here touches the simulation or its rules.
 */
@Global()
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
