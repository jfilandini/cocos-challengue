import { Module } from '@nestjs/common';
import { DatabaseModule } from '../shared/infrastructure/database/database.module';

@Module({
  imports: [DatabaseModule],
})
export class SnapshotModule {}
