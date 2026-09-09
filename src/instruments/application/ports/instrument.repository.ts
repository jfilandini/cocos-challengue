import type { Instrument } from '../../domain/instrument';

export interface InstrumentRepository {
  search(query: string): Promise<Instrument[]>;
}
