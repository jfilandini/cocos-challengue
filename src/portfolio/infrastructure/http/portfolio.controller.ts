import { BadRequestException, Controller, Get, NotFoundException, Param, ParseIntPipe, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { GetPortfolioUseCase, InvalidPortfolioUserError, PortfolioUserNotFoundError } from '../../application/get-portfolio.use-case';
import { PortfolioDataError, PortfolioPriceUnavailableError } from '../../domain/portfolio';

@Controller('users/:userId/portfolio')
export class PortfolioController {
  constructor(private readonly getPortfolio: GetPortfolioUseCase) {}

  @Get()
  async get(@Param('userId', ParseIntPipe) userId: number) {
    try {
      return await this.getPortfolio.execute(userId);
    } catch (error) {
      if (error instanceof InvalidPortfolioUserError) throw new BadRequestException(error.message);
      if (error instanceof PortfolioUserNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof PortfolioDataError) throw new UnprocessableEntityException(error.message);
      if (error instanceof PortfolioPriceUnavailableError) throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }
}
