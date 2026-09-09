export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
  CASH_IN = 'CASH_IN',
  CASH_OUT = 'CASH_OUT',
}

const orderSides: ReadonlySet<string> = new Set(Object.values(OrderSide));

export function isOrderSide(value: unknown): value is OrderSide {
  return typeof value === 'string' && orderSides.has(value);
}

export function isCashTransfer(side: OrderSide): boolean {
  return side === OrderSide.CASH_IN || side === OrderSide.CASH_OUT;
}

export function isInstrumentOrder(side: OrderSide): boolean {
  return side === OrderSide.BUY || side === OrderSide.SELL;
}
