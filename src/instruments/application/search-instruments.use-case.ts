import type { Instrument } from '../domain/instrument';
import type { InstrumentRepository } from './ports/instrument.repository';

export class InvalidInstrumentSearchError extends Error {
  constructor() {
    super('query must have a value');
    this.name = 'InvalidInstrumentSearchError';
  }
}

export class SearchInstrumentsUseCase {
  constructor(private readonly instruments: InstrumentRepository) {}

  execute(query: unknown): Promise<Instrument[]> {
    if (typeof query !== 'string' || !query.trim()) {
      throw new InvalidInstrumentSearchError();
    }

    return this.instruments.search(query.trim());
  }
}
