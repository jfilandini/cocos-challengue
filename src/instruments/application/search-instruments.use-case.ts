import { z } from 'zod';
import type { InstrumentRepository, InstrumentSearchResult } from './ports/instrument.repository';

const positiveInteger = z.union([z.string().regex(/^\d+$/), z.number()])
  .pipe(z.coerce.number<string | number>().int().positive());

const searchSchema = z.object({
  query: z.string().trim().min(1, 'query must have a value'),
  page: positiveInteger.default(1),
  limit: positiveInteger.pipe(z.number().max(100)).default(20),
});

export interface InstrumentSearchPage extends InstrumentSearchResult {
  page: number;
  limit: number;
  totalPages: number;
}

export class InvalidInstrumentSearchError extends Error {
  constructor(message = 'query must have a value') {
    super(message);
    this.name = 'InvalidInstrumentSearchError';
  }
}

export class SearchInstrumentsUseCase {
  constructor(private readonly instruments: InstrumentRepository) {}

  execute(query: unknown, page?: unknown, limit?: unknown): Promise<InstrumentSearchPage> {
    const validated = searchSchema.safeParse({ query, page, limit });
    if (!validated.success) {
      throw new InvalidInstrumentSearchError(validated.error.issues.map(issue =>
        `${issue.path.join('.')}: ${issue.message}`).join('; '));
    }
    const input = validated.data;
    return this.instruments.search(input.query, { page: input.page, limit: input.limit })
      .then(result => ({
        ...result,
        page: input.page,
        limit: input.limit,
        totalPages: Math.ceil(result.total / input.limit),
      }));
  }
}
