import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { SimService } from './sim.service.js';

@Global()
@Module({
  providers: [
    {
      provide: SimService,
      inject: [ConfigService],
      useFactory: async (
        config: ConfigService<AppConfig, true>,
      ): Promise<SimService> => {
        const sim = new SimService(config);
        await sim.load();
        return sim;
      },
    },
  ],
  exports: [SimService],
})
export class SimulationModule {}
