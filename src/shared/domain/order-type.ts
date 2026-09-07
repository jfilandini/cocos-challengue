export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
}

const orderTypes: ReadonlySet<string> = new Set(Object.values(OrderType));

export function isOrderType(value: unknown): value is OrderType {
  return typeof value === 'string' && orderTypes.has(value);
}
