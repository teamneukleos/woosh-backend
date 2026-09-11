import { OrganisationType } from '@prisma/client';

export type SeatKind = 'creator' | 'brand' | 'agency' | 'admin';

export function seatFor(input: {
  isPlatformAdmin: boolean;
  hasCreatorProfile: boolean;
  organisationType: OrganisationType | null;
}): SeatKind {
  if (input.isPlatformAdmin) return 'admin';
  if (input.hasCreatorProfile) return 'creator';
  if (input.organisationType === OrganisationType.AGENCY) return 'agency';
  return 'brand';
}
