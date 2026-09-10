import { ApiProperty } from '@nestjs/swagger';
import { InstrumentType } from '../../../../shared/domain/instrument-type';

export class PortfolioPositionDto {
  @ApiProperty({
    description: 'Tipo de activo (ACCIONES o MONEDA)',
    enum: InstrumentType,
    example: InstrumentType.ACCIONES,
  })
  type!: InstrumentType;

  @ApiProperty({
    description: 'Identificador del instrumento',
    example: '50',
  })
  instrumentId!: string;

  @ApiProperty({
    description: 'Ticker del activo',
    example: 'YPFD',
  })
  ticker!: string;

  @ApiProperty({
    description: 'Nombre o denominación del activo',
    example: 'Y.P.F. S.A.',
  })
  name!: string;

  @ApiProperty({
    description: 'Cantidad total de títulos o saldo de moneda',
    example: 10,
    oneOf: [{ type: 'number' }, { type: 'string' }],
  })
  quantity!: number | string;

  @ApiProperty({
    description: 'Cantidad o saldo bloqueado en órdenes límite pendientes',
    example: 0,
    oneOf: [{ type: 'number' }, { type: 'string' }],
  })
  reservedQuantity!: number | string;

  @ApiProperty({
    description: 'Cantidad o saldo disponible para operar',
    example: 10,
    oneOf: [{ type: 'number' }, { type: 'string' }],
  })
  availableQuantity!: number | string;

  @ApiProperty({
    description: 'Último precio de mercado o paridad monetaria',
    example: '28500.00',
  })
  price!: string;

  @ApiProperty({
    description: 'Fecha del último precio registrado',
    example: '2025-02-01',
    nullable: true,
  })
  priceDate!: string | null;

  @ApiProperty({
    description: 'Valor monetario total de la posición ($)',
    example: '285000.00',
  })
  marketValue!: string;

  @ApiProperty({
    description: 'Rendimiento total acumulado (%) según costo ponderado',
    example: '15.42',
    nullable: true,
  })
  totalReturnPercent!: string | null;

  @ApiProperty({
    description: 'Rendimiento diario (%) calculado contra el cierre previo',
    example: '2.35',
    nullable: true,
  })
  dailyReturnPercent!: string | null;

  @ApiProperty({
    description: 'Indica si la posición proviene de un historial inconsistente o sobrevendido previo',
    example: false,
  })
  inconsistentHistory!: boolean;
}

export class PortfolioResponseDto {
  @ApiProperty({
    description: 'Identificador del usuario dueño de la cuenta',
    example: '1',
  })
  userId!: string;

  @ApiProperty({
    description: 'Moneda base de la cuenta',
    example: 'ARS',
  })
  currency!: string;

  @ApiProperty({
    description: 'Valor total de la cuenta en pesos (efectivo + valor de mercado de activos)',
    example: '335000.00',
  })
  totalValue!: string;

  @ApiProperty({
    description: 'Saldo total de efectivo en pesos',
    example: '50000.00',
  })
  cashBalance!: string;

  @ApiProperty({
    description: 'Pesos comprometidos en órdenes límite de compra pendientes',
    example: '10000.00',
  })
  reservedCash!: string;

  @ApiProperty({
    description: 'Pesos disponibles para operar (cashBalance - reservedCash)',
    example: '40000.00',
  })
  availableCash!: string;

  @ApiProperty({
    description: 'Listado de posiciones y activos que posee el usuario',
    type: [PortfolioPositionDto],
  })
  positions!: PortfolioPositionDto[];
}
