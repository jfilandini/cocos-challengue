import { Body, Controller, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { SubmitOrderUseCase } from '../../application/submit-order.use-case';
import { CancelOrderUseCase } from '../../application/cancel-order.use-case';

@Controller('users/:userId/orders')
export class OrdersController {
  constructor(private readonly submitOrder: SubmitOrderUseCase, private readonly cancelOrder: CancelOrderUseCase) {}

  @Post(':orderId/cancel')
  @HttpCode(200)
  cancel(@Param('userId', ParseIntPipe) userId: number, @Param('orderId', ParseIntPipe) orderId: number) {
    return this.cancelOrder.execute(userId, orderId);
  }

  @Post()
  submit(@Param('userId', ParseIntPipe) userId: number, @Body() body: unknown) {
    return this.submitOrder.execute(userId, body);
  }
}
