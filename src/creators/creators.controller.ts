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
import { CreatorsService } from './creators.service';
import {
  CreatorResponseDto,
  OnboardCreatorDto,
} from './dto/onboard-creator.dto';

@ApiTags('creators')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('creators')
export class CreatorsController {
  constructor(private readonly creatorsService: CreatorsService) {}

  @Post('onboard')
  @ApiOperation({
    summary: 'Onboard as a creator (influencer)',
    description:
      'Creates a Creator profile for the authenticated user. Call after /auth/register.',
  })
  @ApiCreatedResponse({ type: CreatorResponseDto })
  onboard(
    @CurrentUser() user: AuthUser,
    @Body() dto: OnboardCreatorDto,
  ): Promise<CreatorResponseDto> {
    return this.creatorsService.onboard(user.id, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the current user creator profile' })
  @ApiOkResponse({ type: CreatorResponseDto })
  me(@CurrentUser() user: AuthUser): Promise<CreatorResponseDto> {
    return this.creatorsService.me(user.id);
  }
}
