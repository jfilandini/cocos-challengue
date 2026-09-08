import { assertCancellable, InvalidOrderError, OrderResourceNotFoundError } from '../domain/order';
import type { OrderRepository } from './ports/order.repository';

export class CancelOrderUseCase {
  constructor(private readonly orders: OrderRepository) {}

  execute(userId: number, orderId: number) {
    if ([userId, orderId].some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647)) {
      throw new InvalidOrderError('Invalid userId or orderId');
    }
    return this.orders.withUserLock(userId, async transaction => {
      const order = await transaction.findOrder(orderId);
      if (!order) throw new OrderResourceNotFoundError('Order not found for this user');
      assertCancellable(order.status);
      return transaction.cancel(order.id);
    });
  }
}
