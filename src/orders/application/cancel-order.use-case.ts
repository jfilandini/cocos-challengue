import { validateId } from '../../shared/domain/id-validator-helper';
import { assertCancellable, OrderResourceNotFoundError } from '../domain/order';
import type { OrderRepository } from './ports/order.repository';

export class CancelOrderUseCase {
  constructor(private readonly orders: OrderRepository) {}

  execute(userIdInput: unknown, orderIdInput: unknown) {
    const userId = validateId(userIdInput);
    const orderId = validateId(orderIdInput);
    return this.orders.withUserLock(userId, async transaction => {
      const order = await transaction.findOrder(orderId);
      if (!order) throw new OrderResourceNotFoundError('Order not found for this user');
      assertCancellable(order.status);
      return transaction.cancel(order.id);
    });
  }
}
