import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { DatabaseModule } from './shared/infrastructure/database/database.module';
import { HealthController } from './shared/infrastructure/http/health.controller';
import { DomainExceptionFilter } from './shared/infrastructure/http/domain-exception.filter';
import { InstrumentsModule } from './instruments/instruments.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
        autoLogging: true,
        serializers: {
          req(req: { id?: unknown; method?: string; url?: string; query?: unknown; params?: unknown }) {
            return {
              id: req.id,
              method: req.method,
              url: req.url,
              query: req.query,
              params: req.params,
            };
          },
        },
      },
    }),
    DatabaseModule,
    InstrumentsModule,
    PortfolioModule,
    OrdersModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },
  ],
})
export class AppModule {}


