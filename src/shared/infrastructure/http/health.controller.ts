import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DatabaseStatus, HealthStatus } from './health-status';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: HealthStatus; database: DatabaseStatus }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: HealthStatus.OK, database: DatabaseStatus.UP };
    } catch {
      throw new ServiceUnavailableException({ status: HealthStatus.ERROR, database: DatabaseStatus.DOWN });
    }
  }
}
