import type { InstrumentType } from '../../shared/domain/instrument-type';

export interface Instrument {
  readonly id: bigint;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly type: InstrumentType;
}
