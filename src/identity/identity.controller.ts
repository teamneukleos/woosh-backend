import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChangePasswordDto, NotificationPreferencesDto } from './dto/account.dto';
import { DataExportService } from './data-export.service';
import { EmailDto } from './dto/email.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { IdentityService } from './identity.service';

@ApiTags('auth')
@Controller('auth')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly dataExport: DataExportService,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: 'Create a creator, brand, or agency seat — or join from a team invite',
    description:
      'Pass inviteToken to join that organisation as the invited role (no new brand/agency/creator seat). Clicking the invite already proves the inbox, so that account is active immediately. Other signups stay PENDING_VERIFICATION until POST /auth/verify-email.',
  })
  register(@Body() body: RegisterDto) {
    return this.identity.register(body);
  }

  @Post('login')
  @ApiOperation({ summary: 'Sign in and receive access + refresh tokens' })
  login(@Body() body: LoginDto) {
    return this.identity.login(body);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token and issue a new access token' })
  refresh(@Body() body: RefreshDto) {
    return this.identity.refresh(body.refreshToken);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the presented refresh token' })
  logout(@Body() body: RefreshDto) {
    return this.identity.logout(body.refreshToken);
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email with the token from the email (or Nest console in dev)' })
  verifyEmail(@Body() body: VerifyEmailDto) {
    return this.identity.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @ApiOperation({ summary: 'Resend email verification (always returns a generic message)' })
  resendVerification(@Body() body: EmailDto) {
    return this.identity.resendVerification(body.email);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset email (generic response)' })
  forgotPassword(@Body() body: EmailDto) {
    return this.identity.forgotPassword(body.email);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Set a new password using the reset token' })
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.identity.resetPassword(body);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Change password while signed in' })
  changePassword(
    @CurrentUser() user: { id: string },
    @Body() body: ChangePasswordDto,
  ) {
    return this.identity.changePassword(user.id, body);
  }

  @Patch('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update email notification preferences' })
  updatePreferences(
    @CurrentUser() user: { id: string },
    @Body() body: NotificationPreferencesDto,
  ) {
    return this.identity.updateNotificationPreferences(user.id, body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Current user, seat, org, and brands' })
  me(@CurrentUser() user: { id: string }) {
    return this.identity.me(user.id);
  }

  @Get('export')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Download account data as JSON',
    description:
      'Own profile, notifications, and organisations the user can export. OAuth tokens and full NUBANs are omitted.',
  })
  exportAccount(@CurrentUser() user: { id: string }) {
    return this.dataExport.build(user.id);
  }
}
