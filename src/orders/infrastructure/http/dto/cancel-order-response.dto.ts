import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../../../../shared/domain/order-status';

export class CancelOrderResponseDto {
  @ApiProperty({
    description: 'Identificador único de la orden cancelada',
    example: '12',
  })
  id!: string;

  @ApiProperty({
    description: 'Identificador del usuario propietario de la orden',
    example: '1',
  })
  userId!: string;

  @ApiProperty({
    description: 'Estado de la orden tras la cancelación',
    enum: OrderStatus,
    example: OrderStatus.CANCELLED,
  })
  status!: OrderStatus.CANCELLED;
}
