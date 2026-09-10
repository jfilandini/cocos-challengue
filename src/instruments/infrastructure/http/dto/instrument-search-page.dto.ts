import { ApiProperty } from '@nestjs/swagger';
import { InstrumentResponseDto } from './instrument-response.dto';

export class InstrumentSearchPageDto {
  @ApiProperty({ type: [InstrumentResponseDto] })
  items!: InstrumentResponseDto[];

  @ApiProperty({ example: 3, description: 'Total de coincidencias' })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 1, description: 'Cantidad de páginas; cero si no hay coincidencias' })
  totalPages!: number;
}
