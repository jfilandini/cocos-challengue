import { Controller, Get, Query } from '@nestjs/common';
import { SearchInstrumentsUseCase } from '../../application/search-instruments.use-case';
import type { Instrument } from '../../domain/instrument';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly searchInstruments: SearchInstrumentsUseCase) {}

  @Get()
  search(@Query('query') query: unknown): Promise<Instrument[]> {
    return this.searchInstruments.execute(query);
  }
}

