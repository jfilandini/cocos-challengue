import 'reflect-metadata';
import { PrismaService } from '../dist/shared/infrastructure/database/prisma.service.js';
import { rebuildAccountSnapshot } from '../dist/shared/infrastructure/database/account-snapshot.store.js';

const prisma = new PrismaService();
try {
  await prisma.$connect();
  const requestedId = process.argv[2] === undefined ? undefined : BigInt(process.argv[2]);
  let cursor;
  let count = 0;
  for (;;) {
    const users = await prisma.user.findMany({
      where: requestedId === undefined ? {} : { id: requestedId },
      orderBy: { id: 'asc' }, take: 100,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      select: { id: true },
    });
    for (const user of users) {
      await prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
        if (locked.length) await rebuildAccountSnapshot(tx, user.id);
      }, { isolationLevel: 'ReadCommitted', timeout: 120000, maxWait: 10000 });
      count++;
    }
    if (users.length < 100) break;
    cursor = users.at(-1).id;
  }
  if (requestedId !== undefined && count === 0) throw new Error('User not found');
  console.log(`Rebuilt ${count} account snapshots from orders.`);
} finally {
  await prisma.$disconnect();
}
