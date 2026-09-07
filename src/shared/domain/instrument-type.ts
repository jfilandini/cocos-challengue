export enum InstrumentType {
  ACCIONES = 'ACCIONES',
  MONEDA = 'MONEDA',
}

const instrumentTypes: ReadonlySet<string> = new Set(Object.values(InstrumentType));

export function isInstrumentType(value: unknown): value is InstrumentType {
  return typeof value === 'string' && instrumentTypes.has(value);
}
