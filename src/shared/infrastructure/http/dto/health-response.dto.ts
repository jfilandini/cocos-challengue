import type { DatabaseStatus, HealthStatus } from '../health-status';

export class HealthResponseDto {
  status!: HealthStatus;
  database!: DatabaseStatus;
}
