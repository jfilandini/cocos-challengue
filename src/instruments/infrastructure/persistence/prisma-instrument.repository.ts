import type { Currency } from '../../../shared/domain/currency';
import type { InstrumentWithLatestPrice } from '../../domain/instrument';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { InstrumentType, isInstrumentType } from '../../../shared/domain/instrument-type';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import type { InstrumentRepository, InstrumentSearchPagination, InstrumentSearchResult } from '../../application/ports/instrument.repository';

@Injectable()
export class PrismaInstrumentRepository implements InstrumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findWithLatestPrices(ids: bigint[], currency: Currency): Promise<InstrumentWithLatestPrice[]> {
    const instruments = await this.prisma.instrument.findMany({
      where: { OR: [
        { id: { in: ids } },
        { ticker: currency, type: InstrumentType.MONEDA },
      ] },
      select: {
        id: true, ticker: true, name: true,
        marketData: { orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1 },
      },
    });

    return instruments.map(({ id, ticker, name, marketData }) => ({
      id, ticker, name,
      close: marketData[0]?.close.toString() ?? null,
      previousClose: marketData[0]?.previousClose?.toString() ?? null,
      date: marketData[0]?.date.toISOString().slice(0, 10) ?? null,
    }));
  }

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
}
