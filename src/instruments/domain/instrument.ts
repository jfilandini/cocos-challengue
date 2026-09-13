import type { InstrumentType } from '../../shared/domain/instrument-type';

export interface Instrument {
  readonly id: bigint;
  readonly ticker: string;
  readonly name: string;
  readonly type: InstrumentType;
}

export interface InstrumentWithLatestPrice {
  id: bigint;
  ticker: string;
  name: string;
  close: string | null;
  previousClose: string | null;
  date: string | null;
}
