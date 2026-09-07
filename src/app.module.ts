import { Module } from '@nestjs/common';
import { DatabaseModule } from './shared/infrastructure/database/database.module';
import { HealthController } from './shared/infrastructure/http/health.controller';
import { InstrumentsModule } from './instruments/instruments.module';

@Module({
  imports: [DatabaseModule, InstrumentsModule],
  controllers: [HealthController],
})
export class AppModule {}
