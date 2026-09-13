import { AccountSnapshotModule } from '../account-snapshot/account-snapshot.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../shared/infrastructure/database/database.module';
import { SubmitOrderUseCase } from './application/submit-order.use-case';
import { CancelOrderUseCase } from './application/cancel-order.use-case';
import type { OrderRepository } from './application/ports/order.repository';
import { OrdersController } from './infrastructure/http/orders.controller';
import { PrismaOrderRepository } from './infrastructure/persistence/prisma-order.repository';

const ORDER_REPOSITORY = Symbol('OrderRepository');

@Module({
  imports: [AccountSnapshotModule, DatabaseModule],
  controllers: [OrdersController],
  providers: [
    { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
    { provide: SubmitOrderUseCase, useFactory: (repository: OrderRepository) => new SubmitOrderUseCase(repository), inject: [ORDER_REPOSITORY] },
    { provide: CancelOrderUseCase, useFactory: (repository: OrderRepository) => new CancelOrderUseCase(repository), inject: [ORDER_REPOSITORY] },
  ],
})
export class OrdersModule {}
