import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SubmitOrderUseCase } from '../../application/submit-order.use-case';
import { CancelOrderUseCase } from '../../application/cancel-order.use-case';
import { SubmitOrderDto } from './dto/submit-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { CancelOrderResponseDto } from './dto/cancel-order-response.dto';
import { ErrorResponseDto } from '../../../shared/infrastructure/http/dto/error-response.dto';

@ApiTags('Orders')
@Controller('users/:userId/orders')
export class OrdersController {
  constructor(private readonly submitOrder: SubmitOrderUseCase, private readonly cancelOrder: CancelOrderUseCase) {}

  @Post(':orderId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancelar una orden propia en estado NEW',
    description: 'Cancela una orden existente del usuario siempre que se encuentre en estado NEW. Si la orden ya fue ejecutada, rechazada o cancelada previamente, la operación es rechazada con un error 409 Conflict.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'ID numérico del usuario propietario de la orden',
    example: '1',
  })
  @ApiParam({
    name: 'orderId',
    type: String,
    description: 'ID de la orden a cancelar',
    example: '12',
  })
  @ApiResponse({
    status: 200,
    description: 'Orden cancelada exitosamente',
    type: CancelOrderResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'ID de usuario u orden inválido',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Orden no encontrada o no pertenece al usuario',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'La orden no se puede cancelar porque no se encuentra en estado NEW',
    type: ErrorResponseDto,
  })
  async cancel(@Param('userId') userId: string, @Param('orderId') orderId: string) {
    const order = await this.cancelOrder.execute(userId, orderId);
    return { ...order, id: order.id.toString(), userId: order.userId.toString() };
  }

  @Post()
  @ApiOperation({
    summary: 'Enviar una orden al mercado o registrar un movimiento de fondos',
    description: 'Permite enviar una orden de compra o venta (BUY o SELL) de tipo MARKET o LIMIT, o registrar transferencias entrantes/salientes (CASH_IN o CASH_OUT). Soporta especificar la cantidad de acciones exacta (size) o un monto total de inversión en pesos (amount). Las órdenes sin saldo o acciones suficientes son guardadas con estado REJECTED.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'ID numérico del usuario que emite la orden',
    example: '1',
  })
  @ApiBody({
    type: SubmitOrderDto,
    description: 'Cuerpo de la orden. Se debe enviar exactamente uno entre size o amount. Para LIMIT es obligatorio enviar price.',
  })
  @ApiResponse({
    status: 201,
    description: 'Orden registrada y procesada (con estado NEW si es LIMIT válida, FILLED si es MARKET válida, o REJECTED si no cumple con el saldo o acciones necesarias)',
    type: OrderResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Parámetros de la orden inválidos (esquema Zod, campos faltantes, o ambos size y amount provistos)',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario o instrumento no encontrado',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Conflicto de idempotencia por transactionId duplicado con payload discordante',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Precio de mercado no disponible para calcular o ejecutar la orden MARKET',
    type: ErrorResponseDto,
  })
  async submit(@Param('userId') userId: string, @Body() body: unknown) {
    const order = await this.submitOrder.execute(userId, body);
    return { ...order, id: order.id.toString(), userId: order.userId.toString(), instrumentId: order.instrumentId.toString() };
  }
}
