import type { InstrumentType } from '../../shared/domain/instrument-type';

export interface Instrument {
  readonly id: bigint;
  readonly ticker: string;
  readonly name: string;
  readonly type: InstrumentType;
}
