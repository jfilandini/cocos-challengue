import { Controller, Get, Param } from '@nestjs/common';
import { GetPortfolioUseCase } from '../../application/get-portfolio.use-case';
import { GetPortfolioByAccountNumberUseCase } from '../../application/get-portfolio-by-account-number.use-case';

@Controller()
export class PortfolioController {
  constructor(
    private readonly getPortfolioByUser: GetPortfolioUseCase,
    private readonly getPortfolioByAccount: GetPortfolioByAccountNumberUseCase,
  ) {}

  @Get('users/:userId/portfolio')
  async getByUserId(@Param('userId') userId: string) {
    return this.toResponse(await this.getPortfolioByUser.execute(userId));
  }

  @Get('accounts/:accountNumber/portfolio')
  async getByAccountNumber(@Param('accountNumber') accountNumber: string) {
    return this.toResponse(await this.getPortfolioByAccount.execute(accountNumber));
  }
  private toResponse(portfolio: Awaited<ReturnType<GetPortfolioUseCase['execute']>>) {
    return {
      ...portfolio,
      userId: portfolio.userId.toString(),
      positions: portfolio.positions.map(position => ({ ...position, instrumentId: position.instrumentId.toString() })),
    };
  }
}


