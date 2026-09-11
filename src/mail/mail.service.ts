import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailPayload } from './templates';

const RESEND_URL = 'https://api.resend.com/emails';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  configured() {
    return Boolean(this.config.get<string>('RESEND_API_KEY')?.trim());
  }

  frontendUrl(path: string) {
    const base =
      this.config.get<string>('FRONTEND_URL')?.replace(/\/$/, '') ??
      'http://localhost:3000';
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async send(payload: MailPayload) {
    const from =
      this.config.get<string>('EMAIL_FROM')?.trim() ||
      'Woosh <onboarding@resend.dev>';
    const key = this.config.get<string>('RESEND_API_KEY')?.trim();

    if (!key) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('RESEND_API_KEY is required to send email in production');
      }
      this.logger.log(
        `[email-stub] to=${payload.to} subject=${payload.subject}\n${payload.text}`,
      );
      return { id: 'stub', provider: 'console' as const };
    }

    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Resend failed ${response.status}: ${body}`);
      throw new Error(`Email send failed: ${response.status}`);
    }

    const json = (await response.json()) as { id: string };
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[email] sent id=${json.id} to=${payload.to} subject=${payload.subject}`);
    }
    return { id: json.id, provider: 'resend' as const };
  }

  /** Transactional product mail. Failures are logged so register/invite still complete. */
  async sendBestEffort(payload: MailPayload) {
    try {
      return await this.send(payload);
    } catch (error) {
      this.logger.error(
        `Email failed (${payload.subject} → ${payload.to})`,
        error instanceof Error ? error.stack : error,
      );
      return { id: 'failed', provider: 'error' as const };
    }
  }
}
