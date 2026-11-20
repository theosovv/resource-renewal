import { describe, expect, it } from 'vitest';
import { minorUnitsToJsonNumber } from './minor-units.js';

describe('minorUnitsToJsonNumber', () => {
  it('converts a safe Prisma bigint to a JSON integer', () => {
    expect(minorUnitsToJsonNumber(128_000n)).toBe(128_000);
  });

  it('rejects unsafe and negative values', () => {
    expect(() => minorUnitsToJsonNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
      'safe JSON integer range',
    );
    expect(() => minorUnitsToJsonNumber(-1n)).toThrow('cannot be negative');
  });
});
