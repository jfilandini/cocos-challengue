import type { Instrument } from '../../domain/instrument';

export interface InstrumentRepository {
  /** Literal, case-insensitive substring match on ticker or name for stocks,
   * ordered by ticker and then id. Cash instruments are excluded. */
  search(query: string): Promise<Instrument[]>;
}
