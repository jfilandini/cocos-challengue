import { Module } from '@nestjs/common';
import { DatabaseModule } from './shared/infrastructure/database/database.module';
import { HealthController } from './shared/infrastructure/http/health.controller';
import { InstrumentsModule } from './instruments/instruments.module';
import { PortfolioModule } from './portfolio/portfolio.module';

@Module({
  imports: [DatabaseModule, InstrumentsModule, PortfolioModule],
  controllers: [HealthController],
})
export class AppModule {}
