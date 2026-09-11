/** Woosh takes 0% of the creator rate. Paystack processing fees are separate. */
export const DEFAULT_PLATFORM_FEE_RATE = 0;

export function splitFee(gross: number, feeRate = DEFAULT_PLATFORM_FEE_RATE) {
  const platformFee = Math.round(gross * feeRate * 100) / 100;
  const net = Math.round((gross - platformFee) * 100) / 100;
  return { gross, platformFee, net };
}

export function capacityRequired(gross: number) {
  const { platformFee } = splitFee(gross);
  return Math.round((gross + platformFee) * 100) / 100;
}

export function asNumber(
  value: { toNumber?: () => number } | number | null | undefined,
) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  return typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
}
