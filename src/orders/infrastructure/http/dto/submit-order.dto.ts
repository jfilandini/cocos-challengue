import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderSide } from '../../../../shared/domain/order-side';
import { OrderType } from '../../../../shared/domain/order-type';

export class SubmitOrderDto {
  @ApiProperty({
    description: 'Identificador único de la transacción para garantizar idempotencia (ej. UUID)',
    example: '00000000-0000-4000-8000-000000000001',
  })
  transactionId!: string;

  @ApiProperty({
    description: 'Identificador del instrumento financiero a operar',
    example: '47',
    oneOf: [{ type: 'string' }, { type: 'number' }],
  })
  instrumentId!: string | number;

  @ApiProperty({
    description: 'Sentido de la orden o movimiento de fondos',
    enum: OrderSide,
    example: OrderSide.BUY,
  })
  side!: OrderSide;

  @ApiProperty({
    description: 'Tipo de ejecución de la orden (MARKET o LIMIT)',
    enum: OrderType,
    example: OrderType.MARKET,
  })
  type!: OrderType;

  @ApiPropertyOptional({
    description: 'Cantidad de acciones a operar (entero positivo). Enviar exactamente uno entre size o amount.',
    example: 2,
  })
  size?: number;

  @ApiPropertyOptional({
    description: 'Monto total en pesos a invertir/transferir. Enviar exactamente uno entre size o amount. Para CASH_IN/CASH_OUT debe ser un valor entero en pesos.',
    example: '2000.00',
    oneOf: [{ type: 'string' }, { type: 'number' }],
  })
  amount?: string | number;

  @ApiPropertyOptional({
    description: 'Precio límite por acción en pesos. Requerido para órdenes LIMIT, omitir para órdenes MARKET.',
    example: '900.00',
    oneOf: [{ type: 'string' }, { type: 'number' }],
  })
  price?: string | number;
}
