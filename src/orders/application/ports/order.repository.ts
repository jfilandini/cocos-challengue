import type { InstrumentType } from '../../../shared/domain/instrument-type';
import type { AccountSnapshot } from '../../../account-snapshot/domain/account-snapshot';
import type { CancelledOrder, OrderDraft, SubmittedOrder } from '../../domain/order';
import type { OrderStatus } from '../../../shared/domain/order-status';

export interface OrderTransaction {
  findInstrumentById(id: bigint): Promise<{ ticker: string; type: InstrumentType | null; close: string | null } | null>;
  findByTransactionId(transactionId: string): Promise<{ order: SubmittedOrder; originalRequest: string | null } | null>;
  readSnapshot(): Promise<AccountSnapshot | null>;
  initializeSnapshot(): Promise<AccountSnapshot>;
  save(order: OrderDraft, transactionId: string, originalRequest?: string): Promise<SubmittedOrder>;
  findOrder(id: bigint): Promise<{ id: bigint; status: OrderStatus } | null>;
  cancel(id: bigint): Promise<CancelledOrder>;
}

export interface OrderRepository {
  withUserLock<T>(userId: bigint, work: (transaction: OrderTransaction) => Promise<T>): Promise<T>;
}
