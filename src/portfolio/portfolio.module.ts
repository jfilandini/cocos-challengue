import { Module } from '@nestjs/common';
import { DatabaseModule } from '../shared/infrastructure/database/database.module';
import { GetPortfolioUseCase } from './application/get-portfolio.use-case';
import type { PortfolioRepository } from './application/ports/portfolio.repository';
import { PortfolioController } from './infrastructure/http/portfolio.controller';
import { PrismaPortfolioRepository } from './infrastructure/persistence/prisma-portfolio.repository';

const PORTFOLIO_REPOSITORY = Symbol('PortfolioRepository');

@Module({
  imports: [DatabaseModule],
  controllers: [PortfolioController],
  providers: [
    { provide: PORTFOLIO_REPOSITORY, useClass: PrismaPortfolioRepository },
    { provide: GetPortfolioUseCase, useFactory: (repository: PortfolioRepository) => new GetPortfolioUseCase(repository), inject: [PORTFOLIO_REPOSITORY] },
  ],
})
export class PortfolioModule {}
