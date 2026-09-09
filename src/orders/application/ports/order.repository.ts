import type { InstrumentType } from '../../../shared/domain/instrument-type';
import type { LedgerMovement } from '../../../shared/domain/ledger';
import type { CancelledOrder, OrderDraft, SubmittedOrder } from '../../domain/order';
import type { OrderStatus } from '../../../shared/domain/order-status';

export interface OrderTransaction {
  findInstrument(id: bigint): Promise<{ ticker: string | null; type: InstrumentType | null; close: string | null } | null>;
  readMovements(): Promise<LedgerMovement[]>;
  save(order: OrderDraft): Promise<SubmittedOrder>;
  findOrder(id: bigint): Promise<{ id: bigint; status: OrderStatus } | null>;
  cancel(id: bigint): Promise<CancelledOrder>;
}

export interface OrderRepository {
  /** Locks the user before reading resources; commits the order and releases the lock atomically. */
  withUserLock<T>(userId: bigint, work: (transaction: OrderTransaction) => Promise<T>): Promise<T>;
}
