import { Module } from '@nestjs/common';
import { DatabaseModule } from '../shared/infrastructure/database/database.module';
import { SubmitOrderUseCase } from './application/submit-order.use-case';
import { CancelOrderUseCase } from './application/cancel-order.use-case';
import type { OrderRepository } from './application/ports/order.repository';
import { INSTRUMENT_REPOSITORY, InstrumentsModule } from '../instruments/instruments.module';
import type { InstrumentRepository } from '../instruments/application/ports/instrument.repository';
import { OrdersController } from './infrastructure/http/orders.controller';
import { PrismaOrderRepository } from './infrastructure/persistence/prisma-order.repository';

const ORDER_REPOSITORY = Symbol('OrderRepository');

@Module({
  imports: [DatabaseModule,InstrumentsModule],
  controllers: [OrdersController],
  providers: [
    { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
    { provide: SubmitOrderUseCase, useFactory: (repository: OrderRepository, instrumentRepository: InstrumentRepository) => new SubmitOrderUseCase(repository, instrumentRepository), inject: [ORDER_REPOSITORY,INSTRUMENT_REPOSITORY] },
    { provide: CancelOrderUseCase, useFactory: (repository: OrderRepository) => new CancelOrderUseCase(repository), inject: [ORDER_REPOSITORY] },
  ],
})
export class OrdersModule {}
