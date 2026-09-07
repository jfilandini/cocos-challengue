import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import {
  InvalidInstrumentSearchError,
  SearchInstrumentsUseCase,
} from '../../application/search-instruments.use-case';
import type { Instrument } from '../../domain/instrument';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly searchInstruments: SearchInstrumentsUseCase) {}

  @Get()
  async search(@Query('query') query: unknown): Promise<Instrument[]> {
    try {
      return await this.searchInstruments.execute(query);
    } catch (error) {
      if (error instanceof InvalidInstrumentSearchError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
