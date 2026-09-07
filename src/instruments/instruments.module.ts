import { Module } from '@nestjs/common';
import { DatabaseModule } from '../shared/infrastructure/database/database.module';
import { SearchInstrumentsUseCase } from './application/search-instruments.use-case';
import type { InstrumentRepository } from './application/ports/instrument.repository';
import { InstrumentsController } from './infrastructure/http/instruments.controller';
import { PrismaInstrumentRepository } from './infrastructure/persistence/prisma-instrument.repository';

const INSTRUMENT_REPOSITORY = Symbol('InstrumentRepository');

@Module({
  imports: [DatabaseModule],
  controllers: [InstrumentsController],
  providers: [
    { provide: INSTRUMENT_REPOSITORY, useClass: PrismaInstrumentRepository },
    {
      provide: SearchInstrumentsUseCase,
      useFactory: (repository: InstrumentRepository) => new SearchInstrumentsUseCase(repository),
      inject: [INSTRUMENT_REPOSITORY],
    },
  ],
})
export class InstrumentsModule {}
