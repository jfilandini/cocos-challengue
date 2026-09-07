import type { Instrument } from '../domain/instrument';
import type { InstrumentRepository } from './ports/instrument.repository';

export class InvalidInstrumentSearchError extends Error {
  constructor() {
    super('query must be a string between 1 and 255 characters');
    this.name = 'InvalidInstrumentSearchError';
  }
}

export class SearchInstrumentsUseCase {
  constructor(private readonly instruments: InstrumentRepository) {}

  execute(query: unknown): Promise<Instrument[]> {
    if (typeof query !== 'string' || !query.trim() || query.trim().length > 255) {
      throw new InvalidInstrumentSearchError();
    }

    return this.instruments.search(query.trim());
  }
}
