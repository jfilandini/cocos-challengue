import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { isInstrumentType } from '../../../shared/domain/instrument-type';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import type { InstrumentRepository, InstrumentSearchPagination, InstrumentSearchResult } from '../../application/ports/instrument.repository';

@Injectable()
export class PrismaInstrumentRepository implements InstrumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, { page, limit }: InstrumentSearchPagination): Promise<InstrumentSearchResult> {
    const term = query.replace(/[\\%_]/g, '\\$&');
    const where: Prisma.InstrumentWhereInput = {
      OR: [
        { ticker: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
      ],
    };
    // Count and page share the same database snapshot, even during concurrent inserts.
    return this.prisma.$transaction(async transaction => {
      const total = await transaction.instrument.count({ where });
      // Avoid passing an out-of-range offset to Prisma for pages beyond the last result.
      if (page > Math.ceil(total / limit)) return { items: [], total };
      const rows = await transaction.instrument.findMany({
        where,
        select: { id: true, ticker: true, name: true, type: true },
        orderBy: [{ ticker: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      });
      const items = rows.map(({ id, ticker, name, type }) => {
        if (!isInstrumentType(type)) throw new Error(`Invalid instrument type for instrument ${id}`);
        return { id, ticker, name, type };
      });
      return { items, total };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async findInstrumentById(id: bigint) {
    const instrument = await this.prisma.instrument.findUnique({
      where: { id },
      select: { ticker: true, type: true, marketData: { orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1, select: { close: true } } },
    });
    return instrument ? { ticker: instrument.ticker, type: isInstrumentType(instrument.type) ? instrument.type : null, close: instrument.marketData[0]?.close.toString() ?? null } : null;
  }
}
