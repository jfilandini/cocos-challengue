import type { Prisma } from '../../../generated/prisma/client';
import { applyOrder, emptySnapshot, type AccountSnapshot, type SnapshotPosition } from '../../domain/account-snapshot';
import { OrderStatus } from '../../domain/order-status';
import { toSnapshotOrder } from './snapshot-order.mapper';


/** Read only: a missing snapshot is returned as null. */
export async function readAccountSnapshot(tx: Prisma.TransactionClient, userId: bigint): Promise<AccountSnapshot | null> {
  const saved = await tx.accountSnapshot.findUnique({ where: { userId } });
  if (!saved) return null;
  return {
    cash: saved.cash.toString(),
    reservedCash: saved.reservedCash.toString(),
    positions: saved.positions as unknown as SnapshotPosition[],
  };
}

/** Requires the user lock. Initialize missing state without replacing an existing snapshot. */
export async function initializeAccountSnapshot(tx: Prisma.TransactionClient, userId: bigint): Promise<AccountSnapshot> {
  const existing = await readAccountSnapshot(tx, userId);
  return existing ?? rebuildAccountSnapshot(tx, userId);
}

export async function saveAccountSnapshot(tx: Prisma.TransactionClient, userId: bigint, snapshot: AccountSnapshot): Promise<void> {
  const data = {
    cash: snapshot.cash,
    reservedCash: snapshot.reservedCash,
    positions: snapshot.positions.map(position => ({ ...position })),
  };
  await tx.accountSnapshot.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

export async function rebuildAccountSnapshot(tx: Prisma.TransactionClient, userId: bigint): Promise<AccountSnapshot> {
  let snapshot = emptySnapshot();
  let cursor: bigint | undefined;
  for (;;) {
    const orders = await tx.order.findMany({
      where: { userId, status: { in: [OrderStatus.FILLED, OrderStatus.NEW] } },
      orderBy: [{ datetime: 'asc' }, { id: 'asc' }],
      take: 1000,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      include: { instrument: { select: { ticker: true, type: true } } },
    });
    for (const order of orders) snapshot = applyOrder(snapshot, toSnapshotOrder(order));
    if (orders.length < 1000) break;
    cursor = orders[orders.length - 1].id;
  }
  await saveAccountSnapshot(tx, userId, snapshot);
  return snapshot;
}
