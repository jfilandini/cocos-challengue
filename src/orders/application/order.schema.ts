import { z } from 'zod';
import { InvalidIdError, validateId } from '../../shared/domain/id-validator-helper';
import Decimal from 'decimal.js';
import { isCashTransfer, OrderSide } from '../../shared/domain/order-side';
import { OrderType } from '../../shared/domain/order-type';
import { InvalidOrderError, type OrderRequest } from '../domain/order';

const money = z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'Expected a decimal with at most two decimal places'))
  .transform(value => new Decimal(value))
  .refine(value => value.gt(0), 'Amount must be positive')
  .transform(value => value.toFixed(2));

export const orderSizeSchema = z.number().positive()
  .max(2147483647, 'Order size must be at most 2147483647')
  .refine(Number.isInteger, 'size must be a whole number');

export function validateOrderSize(size: number): void {
  const result = orderSizeSchema.safeParse(size);
  if (!result.success) throw new InvalidOrderError(result.error.issues[0].message);
}

const common = {
  transactionId: z.string().trim().min(1).max(100),
  instrumentId: z.unknown().transform((value, ctx) => {
    try {
      return validateId(value);
    } catch (error) {
      if (!(error instanceof InvalidIdError)) throw error;
      ctx.addIssue({ code: 'custom', message: error.message });
      return z.NEVER;
    }
  }),
  size: orderSizeSchema.optional(),
  amount: money.optional(),
};

export const orderSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...common,
    type: z.literal(OrderType.MARKET),
    side: z.enum(OrderSide),
    price: z.never().optional(),
  }),
  z.strictObject({
    ...common,
    type: z.literal(OrderType.LIMIT),
    side: z.enum([OrderSide.BUY, OrderSide.SELL]),
    price: money,
  }),
])
  .refine(order => (order.size !== undefined) !== (order.amount !== undefined), {
    message: 'Send exactly one of size or amount',
  })
  .refine(order => !isCashTransfer(order.side) || order.amount === undefined || /^\d+\.00$/.test(order.amount), {
    message: 'Cash transfers require whole pesos without fractional amounts', path: ['amount'],
  });

export type OrderSubmission = OrderRequest & { transactionId: string };

export function validateOrder(body: unknown): OrderSubmission {
  const result = orderSchema.safeParse(body);
  if (!result.success) {
    throw new InvalidOrderError(result.error.issues.map(issue => `${issue.path.join('.') || 'order'}: ${issue.message}`).join('; '));
  }
  return result.data;
}
