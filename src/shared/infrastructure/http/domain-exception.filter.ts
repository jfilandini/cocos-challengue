import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
}
import { InvalidInstrumentSearchError } from '../../../instruments/application/search-instruments.use-case';
import {
  InvalidPortfolioUserError,
  PortfolioUserNotFoundError,
} from '../../../portfolio/application/get-portfolio.use-case';
import {
  InvalidPortfolioAccountError,
  PortfolioAccountNotFoundError,
} from '../../../portfolio/application/get-portfolio-by-account-number.use-case';
import { AmbiguousPortfolioAccountError } from '../../../portfolio/application/ports/portfolio.repository';
import {
  PortfolioDataError,
  PortfolioPriceUnavailableError,
} from '../../../portfolio/domain/portfolio';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponse>();

    const httpException = this.toHttpException(exception);
    response.status(httpException.getStatus()).json(httpException.getResponse());
  }

  private toHttpException(exception: unknown): HttpException {
    if (exception instanceof HttpException) {
      return exception;
    }

    if (
      exception instanceof InvalidInstrumentSearchError ||
      exception instanceof InvalidPortfolioUserError ||
      exception instanceof InvalidPortfolioAccountError
    ) {
      return new BadRequestException(exception.message);
    }

    if (
      exception instanceof PortfolioUserNotFoundError ||
      exception instanceof PortfolioAccountNotFoundError
    ) {
      return new NotFoundException(exception.message);
    }

    if (exception instanceof AmbiguousPortfolioAccountError) {
      return new ConflictException(exception.message);
    }

    if (exception instanceof PortfolioDataError) {
      return new UnprocessableEntityException(exception.message);
    }

    if (exception instanceof PortfolioPriceUnavailableError) {
      return new ServiceUnavailableException(exception.message);
    }

    this.logger.error(
      'Unhandled exception caught by filter',
      exception instanceof Error ? exception.stack : exception,
    );
    return new InternalServerErrorException('Internal server error');
  }
}
