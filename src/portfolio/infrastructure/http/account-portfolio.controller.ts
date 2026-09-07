import { Controller, Get, Param } from '@nestjs/common';
import { GetPortfolioByAccountNumberUseCase } from '../../application/get-portfolio-by-account-number.use-case';

@Controller('accounts/:accountNumber/portfolio')
export class AccountPortfolioController {
  constructor(private readonly getPortfolio: GetPortfolioByAccountNumberUseCase) {}

  @Get()
  findByAccountNumber(@Param('accountNumber') accountNumber: string) {
    return this.getPortfolio.execute(accountNumber);
  }
}

