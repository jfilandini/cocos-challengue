import { parseDatabaseId } from '../../shared/domain/database-id';
import { assertCancellable, OrderResourceNotFoundError } from '../domain/order';
import type { OrderRepository } from './ports/order.repository';

export class CancelOrderUseCase {
  constructor(private readonly orders: OrderRepository) {}

  execute(userIdInput: unknown, orderIdInput: unknown) {
    const userId = parseDatabaseId(userIdInput);
    const orderId = parseDatabaseId(orderIdInput);
    return this.orders.withUserLock(userId, async transaction => {
      const order = await transaction.findOrder(orderId);
      if (!order) throw new OrderResourceNotFoundError('Order not found for this user');
      assertCancellable(order.status);
      return transaction.cancel(order.id);
    });
  }
}
