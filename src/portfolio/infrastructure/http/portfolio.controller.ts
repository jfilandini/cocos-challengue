import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { GetPortfolioUseCase } from '../../application/get-portfolio.use-case';

@Controller('users/:userId/portfolio')
export class PortfolioController {
  constructor(private readonly getPortfolio: GetPortfolioUseCase) {}

  @Get()
  get(@Param('userId', ParseIntPipe) userId: number) {
    return this.getPortfolio.execute(userId);
  }
}

