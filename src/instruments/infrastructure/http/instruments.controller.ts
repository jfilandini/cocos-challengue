import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SearchInstrumentsUseCase } from '../../application/search-instruments.use-case';
import { InstrumentSearchPageDto } from './dto/instrument-search-page.dto';
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
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiResponse({
    status: 200,
    description: 'Listado de activos encontrados ordenados alfabéticamente por ticker',
    type: InstrumentSearchPageDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Parámetro query, page o limit inválido',
    type: ErrorResponseDto,
  })
  async search(@Query('query') query: unknown, @Query('page') page: unknown, @Query('limit') limit: unknown) {
    const result = await this.searchInstruments.execute(query, page, limit);
    return { ...result, items: result.items.map(instrument => ({ ...instrument, id: instrument.id.toString() })) };
  }
}

