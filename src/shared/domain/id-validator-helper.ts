export class InvalidIdError extends Error {}
export { InvalidIdError as InvalidUserIdError, InvalidIdError as InvalidDatabaseIdError };

/** Convert request IDs to the bigint type. */
export function validateId(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new InvalidIdError('Expected an ID');
  }
  try {
    return BigInt(value);
  } catch {
    throw new InvalidIdError('Invalid ID format');
  }
}

export { validateId as validateIdInput, validateId as validateUserIdInput };
