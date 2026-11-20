export function minorUnitsToJsonNumber(value: bigint): number {
  if (value < 0n) {
    throw new Error('Minor units cannot be negative');
  }
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new Error('Minor units exceed the safe JSON integer range');
  }
  return converted;
}
