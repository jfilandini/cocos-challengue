import { Injectable } from '@nestjs/common';
import { isInstrumentType } from '../../../shared/domain/instrument-type';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import type { InstrumentRepository } from '../../application/ports/instrument.repository';
import type { Instrument } from '../../domain/instrument';

@Injectable()
export class PrismaInstrumentRepository implements InstrumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string): Promise<Instrument[]> {
    const term = query.replace(/[\\%_]/g, '\\$&');

    const rows = await this.prisma.instrument.findMany({
      where: {
        OR: [
          { ticker: { contains: term, mode: 'insensitive' } },
          { name: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, ticker: true, name: true, type: true },
      orderBy: [{ ticker: 'asc' }, { id: 'asc' }],
    });

    return rows.map(({ id, ticker, name, type }) => {
      if (!isInstrumentType(type)) throw new Error(`Invalid instrument type for instrument ${id}`);
      return { id, ticker, name, type };
    });
  }
}
