import { hasPermission } from './permissions';

describe('organisation permissions', () => {
  it('keeps viewers read-only', () => {
    expect(hasPermission('VIEWER', 'creators.search')).toBe(true);
    expect(hasPermission('VIEWER', 'briefs.manage')).toBe(false);
    expect(hasPermission('VIEWER', 'campaigns.manage')).toBe(false);
    expect(hasPermission('VIEWER', 'team.manage')).toBe(false);
  });

  it('separates finance and campaign operations', () => {
    expect(hasPermission('FINANCE', 'payments.approve')).toBe(true);
    expect(hasPermission('FINANCE', 'briefs.manage')).toBe(false);
    expect(hasPermission('MANAGER', 'campaigns.manage')).toBe(true);
    expect(hasPermission('MANAGER', 'payments.approve')).toBe(false);
  });

  it('honours explicit permission overrides', () => {
    expect(
      hasPermission('VIEWER', 'team.manage', { canManageTeam: true }),
    ).toBe(true);
    expect(
      hasPermission('VIEWER', 'data.export', { canExportData: true }),
    ).toBe(true);
  });
});
