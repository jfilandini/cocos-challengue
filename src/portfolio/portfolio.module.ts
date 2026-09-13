import { InstrumentsModule, INSTRUMENT_REPOSITORY } from '../instruments/instruments.module';
import type { InstrumentRepository } from '../instruments/application/ports/instrument.repository';
import { AccountSnapshotModule } from '../account-snapshot/account-snapshot.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../shared/infrastructure/database/database.module';
import { GetPortfolioUseCase } from './application/get-portfolio.use-case';
import { GetPortfolioByAccountNumberUseCase } from './application/get-portfolio-by-account-number.use-case';
import type { PortfolioRepository } from './application/ports/portfolio.repository';
import { PortfolioController } from './infrastructure/http/portfolio.controller';
import { PrismaPortfolioRepository } from './infrastructure/persistence/prisma-portfolio.repository';

const PORTFOLIO_REPOSITORY = Symbol('PortfolioRepository');

@Module({
  imports: [AccountSnapshotModule, DatabaseModule, InstrumentsModule],
  controllers: [PortfolioController],
  providers: [
    { provide: PORTFOLIO_REPOSITORY, useClass: PrismaPortfolioRepository },
    { provide: GetPortfolioUseCase, useFactory: (repository: PortfolioRepository, instruments: InstrumentRepository) => new GetPortfolioUseCase(repository, instruments), inject: [PORTFOLIO_REPOSITORY, INSTRUMENT_REPOSITORY] },
    { provide: GetPortfolioByAccountNumberUseCase, useFactory: (repository: PortfolioRepository, instruments: InstrumentRepository) => new GetPortfolioByAccountNumberUseCase(repository, instruments), inject: [PORTFOLIO_REPOSITORY, INSTRUMENT_REPOSITORY] },
  ],
})
export class PortfolioModule {}

