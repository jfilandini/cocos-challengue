export enum OrderStatus {
  NEW = 'NEW',
  FILLED = 'FILLED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

const orderStatuses: ReadonlySet<string> = new Set(Object.values(OrderStatus));

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && orderStatuses.has(value);
}
