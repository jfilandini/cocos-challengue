import { ApiProperty } from '@nestjs/swagger';
import { OrderSide } from '../../../../shared/domain/order-side';
import { OrderStatus } from '../../../../shared/domain/order-status';
import { OrderType } from '../../../../shared/domain/order-type';

export class OrderResponseDto {
  @ApiProperty({
    description: 'Identificador único de la orden generada',
    example: '101',
  })
  id!: string;

  @ApiProperty({
    description: 'Identificador del usuario que emitió la orden',
    example: '1',
  })
  userId!: string;

  @ApiProperty({
    description: 'Identificador del instrumento operado',
    example: '47',
  })
  instrumentId!: string;

  @ApiProperty({
    description: 'Sentido de la orden',
    enum: OrderSide,
    example: OrderSide.BUY,
  })
  side!: OrderSide;

  @ApiProperty({
    description: 'Tipo de orden ejecutada',
    enum: OrderType,
    example: OrderType.MARKET,
  })
  type!: OrderType;

  @ApiProperty({
    description: 'Cantidad de acciones calculada o enviada',
    example: 2,
  })
  size!: number;

  @ApiProperty({
    description: 'Precio unitario de ejecución o precio límite en pesos',
    example: '950.00',
  })
  price!: string;

  @ApiProperty({
    description: 'Estado resultante de la orden (NEW, FILLED o REJECTED)',
    enum: OrderStatus,
    example: OrderStatus.FILLED,
  })
  status!: OrderStatus;

  @ApiProperty({
    description: 'Identificador de transacción idempotente asociado',
    example: '00000000-0000-4000-8000-000000000001',
  })
  transactionId!: string;

  @ApiProperty({
    description: 'Fecha y hora de creación de la orden en formato ISO',
    example: '2026-09-09T22:00:00.000Z',
  })
  datetime!: string;
}
