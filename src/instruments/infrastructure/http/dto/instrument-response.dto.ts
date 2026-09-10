import { ApiProperty } from '@nestjs/swagger';
import { InstrumentType } from '../../../../shared/domain/instrument-type';

export class InstrumentResponseDto {
  @ApiProperty({
    description: 'Identificador único del instrumento',
    example: '50',
  })
  id!: string;

  @ApiProperty({
    description: 'Ticker o símbolo del instrumento',
    example: 'YPFD',
  })
  ticker!: string;

  @ApiProperty({
    description: 'Nombre o razón social del instrumento',
    example: 'Y.P.F. S.A.',
  })
  name!: string;

  @ApiProperty({
    description: 'Tipo de instrumento financiero',
    enum: InstrumentType,
    example: InstrumentType.ACCIONES,
  })
  type!: InstrumentType;
}
