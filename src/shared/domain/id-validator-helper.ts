export class InvalidIdError extends Error {}
export { InvalidIdError as InvalidUserIdError, InvalidIdError as InvalidDatabaseIdError };

const MAX_POSTGRES_BIGINT = 9223372036854775807n;

/** Reject lossy JSON numbers before converting positive database IDs. */
export function validateId(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new InvalidIdError('Expected an ID');
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new InvalidIdError('Numeric IDs must be safe integers; send large IDs as strings');
  }
  if (typeof value === 'string' && (value.length > 19 || !/^[1-9]\d*$/.test(value))) {
    throw new InvalidIdError('Expected a positive decimal ID');
  }
  const id = BigInt(value);
  if (id <= 0n || id > MAX_POSTGRES_BIGINT) {
    throw new InvalidIdError('ID must be between 1 and 9223372036854775807');
  }
  return id;
}

export { validateId as validateIdInput, validateId as validateUserIdInput };
