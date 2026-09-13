import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetPortfolioUseCase } from '../../application/get-portfolio.use-case';
import { GetPortfolioByAccountNumberUseCase } from '../../application/get-portfolio-by-account-number.use-case';
import { PortfolioResponseDto } from './dto/portfolio-response.dto';
import type { PortfolioPositionDto } from './dto/portfolio-response.dto';
import { ErrorResponseDto } from '../../../shared/infrastructure/http/dto/error-response.dto';

@ApiTags('Portfolio')
@Controller()
export class PortfolioController {
  constructor(
    private readonly getPortfolioByUser: GetPortfolioUseCase,
    private readonly getPortfolioByAccount: GetPortfolioByAccountNumberUseCase,
  ) {}

  @Get('users/:userId/portfolio')
  @ApiOperation({
    summary: 'Obtener portfolio por ID de usuario',
    description: 'Devuelve el valor total de la cuenta de un usuario, sus pesos disponibles para operar y el listado de activos que posee (incluyendo cantidad de acciones, el valor total monetario de la posición ($) y el rendimiento total (%)).',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'ID numérico del usuario',
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Portfolio del usuario obtenido exitosamente',
    type: PortfolioResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'ID de usuario inválido',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario no encontrado',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Precios de mercado no disponibles para la valuación de la cartera',
    type: ErrorResponseDto,
  })
  async getByUserId(@Param('userId') userId: string): Promise<PortfolioResponseDto> {
    return this.toResponse(await this.getPortfolioByUser.execute(userId));
  }

  @Get('accounts/:accountNumber/portfolio')
  @ApiOperation({
    summary: 'Obtener portfolio por número de cuenta',
    description: 'Devuelve el portfolio del usuario correspondiente al número de cuenta especificado.',
  })
  @ApiParam({
    name: 'accountNumber',
    type: String,
    description: 'Número de cuenta del usuario',
    example: '000001',
  })
  @ApiResponse({
    status: 200,
    description: 'Portfolio de la cuenta obtenido exitosamente',
    type: PortfolioResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Número de cuenta inválido',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Cuenta no encontrada',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Número de cuenta ambiguo o duplicado',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Precios de mercado no disponibles para la valuación de la cartera',
    type: ErrorResponseDto,
  })
  async getByAccountNumber(@Param('accountNumber') accountNumber: string): Promise<PortfolioResponseDto> {
    return this.toResponse(await this.getPortfolioByAccount.execute(accountNumber));
  }
  private toResponse(portfolio: Awaited<ReturnType<GetPortfolioUseCase['execute']>>): PortfolioResponseDto {
    return {
      userId: portfolio.userId.toString(),
      currency: portfolio.currency,
      totalValue: portfolio.totalValue,
      cashBalance: portfolio.cashBalance,
      reservedCash: portfolio.reservedCash,
      availableCash: portfolio.availableCash,
      positions: portfolio.positions.map((position): PortfolioPositionDto => ({
        type: position.type,
        instrumentId: position.instrumentId.toString(),
        ticker: position.ticker,
        name: position.name,
        quantity: position.quantity,
        reservedQuantity: position.reservedQuantity,
        availableQuantity: position.availableQuantity,
        price: position.price,
        priceDate: position.priceDate,
        marketValue: position.marketValue,
        totalReturnPercent: position.totalReturnPercent,
        dailyReturnPercent: position.dailyReturnPercent,
        inconsistentHistory: position.inconsistentHistory,
      })),
    };
  }
}

