import type { OrderRequest } from '../domain/order';

/** Stable representation of validated client intent, independent of execution prices. */
export function serializeOrderRequest(request: OrderRequest): string {
  return JSON.stringify({
    instrumentId: request.instrumentId.toString(),
    side: request.side,
    type: request.type,
    size: request.size ?? null,
    amount: request.amount ?? null,
    price: request.price ?? null,
  });
}