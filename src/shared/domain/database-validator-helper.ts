export class InvalidDatabaseIdError extends Error {}

/** Convert request IDs to the type used by persistence. */
export function validateIdInput(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new InvalidDatabaseIdError('Expected an ID');
  }
  try {
    return BigInt(value);
  } catch {
    throw new InvalidDatabaseIdError('Invalid ID format');
  }
}
