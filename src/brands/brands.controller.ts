import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { BrandsService } from './brands.service';
import {
  BrandMembershipResponseDto,
  OnboardBrandDto,
} from './dto/onboard-brand.dto';

@ApiTags('brands')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Post('onboard')
  @ApiOperation({
    summary: 'Onboard a brand or agency account',
    description:
      'Creates a Brand and links the authenticated user as OWNER (brand marketer / SME) or AGENCY. Call after /auth/register with intendedRole=BRAND.',
  })
  @ApiCreatedResponse({ type: BrandMembershipResponseDto })
  onboard(
    @CurrentUser() user: AuthUser,
    @Body() dto: OnboardBrandDto,
  ): Promise<BrandMembershipResponseDto> {
    return this.brandsService.onboard(user.id, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'List brands the current user belongs to' })
  @ApiOkResponse({ type: BrandMembershipResponseDto, isArray: true })
  me(@CurrentUser() user: AuthUser): Promise<BrandMembershipResponseDto[]> {
    return this.brandsService.me(user.id);
  }
}
