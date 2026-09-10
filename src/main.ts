import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Cocos Challenge Backend API')
    .setDescription(
      'API REST para consulta de portfolio, búsqueda de activos en el mercado y envío/cancelación de órdenes de compra y venta.',
    )
    .setVersion('1.0.0')
    .addTag('Portfolio', 'Consulta de saldo en pesos, valor total de cuenta y listado de posiciones con rendimientos')
    .addTag('Instruments', 'Búsqueda de activos por ticker o nombre dentro del mercado')
    .addTag('Orders', 'Envío de órdenes MARKET/LIMIT, transferencias CASH_IN/CASH_OUT y cancelación de órdenes NEW')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un puerto válido');
  }
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

