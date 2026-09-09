import { Controller, Get, Query } from '@nestjs/common';
import { SearchInstrumentsUseCase } from '../../application/search-instruments.use-case';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly searchInstruments: SearchInstrumentsUseCase) {}

  @Get()
  async search(@Query('query') query: unknown) {
    const instruments = await this.searchInstruments.execute(query);
    return instruments.map(instrument => ({ ...instrument, id: instrument.id.toString() }));
  }
}

