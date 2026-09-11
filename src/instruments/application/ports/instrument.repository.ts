import type { Instrument } from '../../domain/instrument';
import type { InstrumentType } from '../../../shared/domain/instrument-type';

export interface InstrumentSearchPagination {
  page: number;
  limit: number;
}

export interface InstrumentSearchResult {
  items: Instrument[];
  total: number;
}

export interface InstrumentRepository {
  search(query: string, pagination: InstrumentSearchPagination): Promise<InstrumentSearchResult>;
  findInstrumentById(id: bigint): Promise<{ ticker: string; type: InstrumentType | null; close: string | null } | null>;
}
