export function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

export function asNumber(value: { toNumber?: () => number } | number | null | undefined) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  return typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
}
