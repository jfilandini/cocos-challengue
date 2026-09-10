import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SearchInstrumentsUseCase } from '../../application/search-instruments.use-case';
import { InstrumentResponseDto } from './dto/instrument-response.dto';
import { ErrorResponseDto } from '../../../shared/infrastructure/http/dto/error-response.dto';

@ApiTags('Instruments')
@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly searchInstruments: SearchInstrumentsUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Buscar activos en el mercado',
    description: 'Devuelve el listado de activos similares a la búsqueda realizada dentro del mercado (soporta búsqueda por ticker y/o por nombre).',
  })
  @ApiQuery({
    name: 'query',
    type: String,
    description: 'Término de búsqueda por ticker o nombre',
    required: true,
    example: 'ypf',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado de activos encontrados ordenados alfabéticamente por ticker',
    type: [InstrumentResponseDto],
  })
  @ApiResponse({
    status: 400,
    description: 'Parámetro query ausente, vacío o inválido',
    type: ErrorResponseDto,
  })
  async search(@Query('query') query: unknown) {
    const instruments = await this.searchInstruments.execute(query);
    return instruments.map(instrument => ({ ...instrument, id: instrument.id.toString() }));
  }
}

