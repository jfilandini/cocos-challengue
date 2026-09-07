import type { Instrument } from '../../domain/instrument';

export interface InstrumentRepository {
  /** Literal, case-insensitive substring match on ticker or name for all instruments,
   * including currencies, ordered by ticker and then id. */
  search(query: string): Promise<Instrument[]>;
}
