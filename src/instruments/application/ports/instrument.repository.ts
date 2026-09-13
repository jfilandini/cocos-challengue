import type { Currency } from '../../../shared/domain/currency';
import type { Instrument, InstrumentWithLatestPrice } from '../../domain/instrument';

export interface InstrumentSearchPagination {
  page: number;
  limit: number;
}

export interface InstrumentSearchResult {
  items: Instrument[];
  total: number;
}

export interface InstrumentRepository {
  findWithLatestPrices(ids: bigint[], currency: Currency): Promise<InstrumentWithLatestPrice[]>;
  search(query: string, pagination: InstrumentSearchPagination): Promise<InstrumentSearchResult>;
}
