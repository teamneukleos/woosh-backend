import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../../common/permissions';

export const ORG_REQUIRED_KEY = 'org_required';
export const ORG_PERMISSION_KEY = 'org_permission';

export const RequireOrg = () => SetMetadata(ORG_REQUIRED_KEY, true);

export const RequirePermission = (permission: Permission) =>
  SetMetadata(ORG_PERMISSION_KEY, permission);
