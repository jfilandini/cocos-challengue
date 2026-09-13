import type { Instrument } from '../../domain/instrument';

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
}
