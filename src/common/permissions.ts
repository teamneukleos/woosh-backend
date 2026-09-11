import { MembershipRole } from '@prisma/client';

export type Permission =
  | 'team.manage'
  | 'rates.edit'
  | 'payments.approve'
  | 'data.export'
  | 'briefs.manage'
  | 'campaigns.manage'
  | 'creators.search'
  | 'analytics.view';

export type MembershipFlags = {
  role: MembershipRole;
  canApprovePayments?: boolean;
  canEditRates?: boolean;
  canManageTeam?: boolean;
  canExportData?: boolean;
};

const roleDefaults: Record<MembershipRole, Permission[]> = {
  OWNER: [
    'team.manage',
    'rates.edit',
    'payments.approve',
    'data.export',
    'briefs.manage',
    'campaigns.manage',
    'creators.search',
    'analytics.view',
  ],
  ADMIN: [
    'team.manage',
    'rates.edit',
    'payments.approve',
    'data.export',
    'briefs.manage',
    'campaigns.manage',
    'creators.search',
    'analytics.view',
  ],
  MANAGER: [
    'briefs.manage',
    'campaigns.manage',
    'creators.search',
    'analytics.view',
  ],
  ACCOUNT_MANAGER: [
    'briefs.manage',
    'campaigns.manage',
    'creators.search',
    'analytics.view',
  ],
  FINANCE: ['payments.approve', 'data.export', 'analytics.view'],
  VIEWER: ['analytics.view', 'creators.search'],
};

export function permissionsForRole(role: MembershipRole): Permission[] {
  return roleDefaults[role];
}

export function hasPermission(
  role: MembershipRole,
  permission: Permission,
  overrides?: Omit<MembershipFlags, 'role'>,
): boolean {
  if (overrides?.canApprovePayments && permission === 'payments.approve') {
    return true;
  }
  if (overrides?.canEditRates && permission === 'rates.edit') return true;
  if (overrides?.canManageTeam && permission === 'team.manage') return true;
  if (overrides?.canExportData && permission === 'data.export') return true;
  return permissionsForRole(role).includes(permission);
}

export function effectivePermissions(flags: MembershipFlags): Permission[] {
  const granted = new Set(permissionsForRole(flags.role));
  if (flags.canApprovePayments) granted.add('payments.approve');
  if (flags.canEditRates) granted.add('rates.edit');
  if (flags.canManageTeam) granted.add('team.manage');
  if (flags.canExportData) granted.add('data.export');
  return [...granted];
}
