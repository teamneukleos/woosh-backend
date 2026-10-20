import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentWorkspace } from './decorators/current-workspace.decorator';
import { RequireOrg, RequirePermission } from './decorators/require-permission.decorator';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { WorkspaceGuard } from './guards/workspace.guard';
import { OrganisationService } from './organisation.service';
import type { WorkspaceSnapshot } from './workspace.types';

@ApiTags('brands')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('brands')
export class BrandsController {
  constructor(private readonly organisation: OrganisationService) {}

  @Get()
  @RequireOrg()
  @ApiOperation({
    summary: 'List brands in this organisation',
    description:
      'Each brand has its own wallet. Money never crosses Brand rows — including extra lines under a brand seat.',
  })
  list(@CurrentWorkspace() ctx: WorkspaceSnapshot) {
    return { brands: ctx.brands, activeBrandId: ctx.activeBrandId };
  }

  @Post()
  @RequirePermission('team.manage')
  @ApiOperation({
    summary: 'Add a brand (agency or brand seat)',
    description:
      'Creates the brand, an NGN wallet, and a brand membership for you. Brand seats may add further brand lines the same way agencies add clients.',
  })
  create(
    @CurrentWorkspace() ctx: WorkspaceSnapshot,
    @Body() body: CreateBrandDto,
  ) {
    return this.organisation.createBrand(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('team.manage')
  @ApiOperation({ summary: 'Rename or update a brand' })
  update(
    @CurrentWorkspace() ctx: WorkspaceSnapshot,
    @Param('id') id: string,
    @Body() body: UpdateBrandDto,
  ) {
    return this.organisation.updateBrand(ctx, id, body);
  }
}
