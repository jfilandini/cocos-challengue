export interface Instrument {
  readonly id: number;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly type: string | null;
}
