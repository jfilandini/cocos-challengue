import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { DatabaseStatus, HealthStatus } from './health-status';
import type { HealthResponseDto } from './dto/health-response.dto';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponseDto> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: HealthStatus.OK, database: DatabaseStatus.UP };
    } catch {
      const response: HealthResponseDto = { status: HealthStatus.ERROR, database: DatabaseStatus.DOWN };
      throw new ServiceUnavailableException(response);
    }
  }
}
