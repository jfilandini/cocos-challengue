import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { GetPortfolioUseCase } from '../../application/get-portfolio.use-case';
import { GetPortfolioByAccountNumberUseCase } from '../../application/get-portfolio-by-account-number.use-case';

@Controller()
export class PortfolioController {
  constructor(
    private readonly getPortfolioByUser: GetPortfolioUseCase,
    private readonly getPortfolioByAccount: GetPortfolioByAccountNumberUseCase,
  ) {}

  @Get('users/:userId/portfolio')
  getByUserId(@Param('userId', ParseIntPipe) userId: number) {
    return this.getPortfolioByUser.execute(userId);
  }

  @Get('accounts/:accountNumber/portfolio')
  getByAccountNumber(@Param('accountNumber') accountNumber: string) {
    return this.getPortfolioByAccount.execute(accountNumber);
  }
}


