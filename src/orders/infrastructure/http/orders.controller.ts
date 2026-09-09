import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { SubmitOrderUseCase } from '../../application/submit-order.use-case';
import { CancelOrderUseCase } from '../../application/cancel-order.use-case';

@Controller('users/:userId/orders')
export class OrdersController {
  constructor(private readonly submitOrder: SubmitOrderUseCase, private readonly cancelOrder: CancelOrderUseCase) {}

  @Post(':orderId/cancel')
  @HttpCode(200)
  async cancel(@Param('userId') userId: string, @Param('orderId') orderId: string) {
    const order = await this.cancelOrder.execute(userId, orderId);
    return { ...order, id: order.id.toString(), userId: order.userId.toString() };
  }

  @Post()
  async submit(@Param('userId') userId: string, @Body() body: unknown) {
    const order = await this.submitOrder.execute(userId, body);
    return { ...order, id: order.id.toString(), userId: order.userId.toString(), instrumentId: order.instrumentId.toString() };
  }
}
