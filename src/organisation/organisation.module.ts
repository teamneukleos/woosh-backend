import { Module } from '@nestjs/common';
import { BrandsController } from './brands.controller';
import { InvitePreviewController } from './invite-preview.controller';
import { WorkspaceGuard } from './guards/workspace.guard';
import { OrganisationService } from './organisation.service';
import { TeamController } from './team.controller';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  controllers: [
    WorkspaceController,
    BrandsController,
    TeamController,
    InvitePreviewController,
  ],
  providers: [WorkspaceService, OrganisationService, WorkspaceGuard],
  exports: [WorkspaceService, WorkspaceGuard],
})
export class OrganisationModule {}
