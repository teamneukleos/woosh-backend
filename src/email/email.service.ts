import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.from =
      this.config.get<string>('EMAIL_FROM') ?? 'Woosh <onboarding@resend.dev>';
    this.resend = apiKey ? new Resend(apiKey) : null;

    if (!this.resend) {
      this.logger.warn(
        'RESEND_API_KEY is not set — password reset emails will be logged only',
      );
    }
  }

  async sendPasswordResetEmail(params: {
    to: string;
    firstName: string;
    resetUrl: string;
  }): Promise<void> {
    const { to, firstName, resetUrl } = params;
    const subject = 'Reset your Woosh password';
    const html = `
      <p>Hi ${firstName},</p>
      <p>We received a request to reset your Woosh password.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in a short time. If you did not request a reset, you can ignore this email.</p>
      <p>— Woosh</p>
    `;

    if (!this.resend) {
      this.logger.log(`[dev] Password reset for ${to}: ${resetUrl}`);
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject,
      html,
    });

    if (error) {
      this.logger.error(`Failed to send reset email to ${to}`, error);
      throw new Error('Failed to send password reset email');
    }
  }
}
