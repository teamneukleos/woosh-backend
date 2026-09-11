import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentWorkspace } from './decorators/current-workspace.decorator';
import { RequirePermission } from './decorators/require-permission.decorator';
import { UpdateOrganisationDto } from './dto/update-organisation.dto';
import { SwitchBrandDto } from './dto/switch-brand.dto';
import { WorkspaceGuard } from './guards/workspace.guard';
import { OrganisationService } from './organisation.service';
import type { WorkspaceSnapshot } from './workspace.types';

@ApiTags('workspace')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller()
export class WorkspaceController {
  constructor(private readonly organisation: OrganisationService) {}

  @Get('workspace')
  @ApiHeader({
    name: 'X-Brand-Id',
    required: false,
    description: 'Optional active brand. Falls back to the first brand in the roster.',
  })
  @ApiOperation({
    summary: 'Current workspace: seat, org, brands, role, permissions',
    description:
      'Agency switcher is client-held: pass brandId as a query or X-Brand-Id header. POST /workspace/active-brand validates access.',
  })
  workspace(
    @CurrentUser() user: { id: string },
    @Query('brandId') brandId?: string,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    return this.organisation.getWorkspace(user.id, headerBrandId || brandId);
  }

  @Post('workspace/active-brand')
  @ApiOperation({
    summary: 'Validate and resolve a brand switch',
    description:
      'Does not mix wallets. Returns the workspace with that brand as active. Send the same id as X-Brand-Id on later requests.',
  })
  switchBrand(@CurrentUser() user: { id: string }, @Body() body: SwitchBrandDto) {
    return this.organisation.switchBrand(user.id, body.brandId);
  }

  @Patch('organisation')
  @RequirePermission('team.manage')
  @ApiOperation({ summary: 'Update the organisation profile' })
  updateOrganisation(
    @CurrentWorkspace() ctx: WorkspaceSnapshot,
    @Body() body: UpdateOrganisationDto,
  ) {
    return this.organisation.updateOrganisation(ctx, body);
  }
}
