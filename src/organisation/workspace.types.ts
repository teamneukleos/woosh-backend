import type { MembershipRole, OrganisationType } from '@prisma/client';
import type { Permission } from '../common/permissions';
import type { SeatKind } from '../common/seat';

export type BrandSnapshot = {
  id: string;
  organisationId: string;
  name: string;
  industry: string | null;
  country: string;
  clientHasAccess: boolean;
  wallet: { id: string; currency: string } | null;
  createdAt: Date;
};

export type OrganisationSnapshot = {
  id: string;
  type: OrganisationType;
  legalName: string;
  publicName: string;
  industry: string | null;
  website: string | null;
  country: string;
  verifiedAt: Date | null;
};

export type MembershipSnapshot = {
  role: MembershipRole;
  canApprovePayments: boolean;
  canEditRates: boolean;
  canManageTeam: boolean;
  canExportData: boolean;
  permissions: Permission[];
};

export type WorkspaceSnapshot = {
  seat: SeatKind;
  user: {
    id: string;
    email: string;
    name: string | null;
    isPlatformAdmin: boolean;
  };
  organisation: OrganisationSnapshot | null;
  membership: MembershipSnapshot | null;
  brands: BrandSnapshot[];
  activeBrandId: string | null;
  activeBrand: BrandSnapshot | null;
};
