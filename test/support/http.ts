import { z } from 'zod';
import { OrderSide } from '../../src/shared/domain/order-side.js';
import { OrderType } from '../../src/shared/domain/order-type.js';
import { OrderStatus } from '../../src/shared/domain/order-status.js';
import { InstrumentType } from '../../src/shared/domain/instrument-type.js';

// Validate untrusted HTTP JSON before assertions use its fields.
export const orderResponse = z.strictObject({
  id: z.string(), userId: z.string(), instrumentId: z.string(), transactionId: z.string(),
  side: z.enum(OrderSide), type: z.enum(OrderType), status: z.enum(OrderStatus),
  size: z.number(), price: z.string(), datetime: z.string(),
});
export const cancellationResponse = z.strictObject({
  id: z.string(), userId: z.string(), status: z.literal(OrderStatus.CANCELLED),
});
export const errorResponse = z.object({ statusCode: z.number(), message: z.union([z.string(), z.array(z.string())]), error: z.string() });
export const instrumentPage = z.strictObject({
  items: z.array(z.strictObject({ id: z.string(), ticker: z.string(), name: z.string(), type: z.enum(InstrumentType) })),
  total: z.number(), page: z.number(), limit: z.number(), totalPages: z.number(),
});
export const portfolioResponse = z.strictObject({
  userId: z.string(), currency: z.string(), totalValue: z.string(), cashBalance: z.string(),
  reservedCash: z.string(), availableCash: z.string(),
  positions: z.array(z.strictObject({
    type: z.enum(InstrumentType), instrumentId: z.string(), ticker: z.string(), name: z.string(),
    quantity: z.union([z.number(), z.string()]), reservedQuantity: z.union([z.number(), z.string()]),
    availableQuantity: z.union([z.number(), z.string()]), price: z.string(), priceDate: z.string().nullable(),
    marketValue: z.string(), totalReturnPercent: z.string().nullable(), dailyReturnPercent: z.string().nullable(),
    inconsistentHistory: z.boolean(),
  })),
});
