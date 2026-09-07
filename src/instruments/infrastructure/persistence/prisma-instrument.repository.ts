import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import type { InstrumentRepository } from '../../application/ports/instrument.repository';
import type { Instrument } from '../../domain/instrument';

@Injectable()
export class PrismaInstrumentRepository implements InstrumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string): Promise<Instrument[]> {
    // Prisma's contains uses LIKE: escape its metacharacters for literal searches.
    const term = query.replace(/[\\%_]/g, '\\$&');

    const rows = await this.prisma.instrument.findMany({
      where: {
        type: 'ACCIONES',
        OR: [
          { ticker: { contains: term, mode: 'insensitive' } },
          { name: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, ticker: true, name: true, type: true },
      orderBy: [{ ticker: 'asc' }, { id: 'asc' }],
    });

    return rows.map(({ id, ticker, name, type }) => ({ id, ticker, name, type }));
  }
}
