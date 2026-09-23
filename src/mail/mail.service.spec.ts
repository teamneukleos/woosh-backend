import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NODE_ENV = originalEnv;
    jest.resetAllMocks();
  });

  function service(env: Record<string, string | undefined> = {}) {
    const config = {
      get: (key: string) => env[key],
    } as ConfigService;
    return new MailService(config);
  }

  it('logs instead of calling Resend when no key is set', async () => {
    process.env.NODE_ENV = 'development';
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await service().send({
      to: 'a@woosh.test',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    expect(result.provider).toBe('console');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to stub email in production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(
      service().send({
        to: 'a@woosh.test',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    ).rejects.toThrow('RESEND_API_KEY');
  });

  it('posts to Resend when a key is configured', async () => {
    process.env.NODE_ENV = 'development';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 're_123' }),
    }) as unknown as typeof fetch;

    const result = await service({
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Woosh <hello@woosh.test>',
    }).send({
      to: 'a@woosh.test',
      subject: 'Verify your Woosh email',
      html: '<p>Hi</p>',
      text: 'Hi',
    });

    expect(result).toEqual({ id: 're_123', provider: 'resend' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('builds frontend URLs from FRONTEND_URL', () => {
    expect(
      service({ FRONTEND_URL: 'http://localhost:3000/' }).frontendUrl(
        '/login?reset=abc',
      ),
    ).toBe('http://localhost:3000/login?reset=abc');
  });

  it('adds https to a host-only FRONTEND_URL', () => {
    expect(
      service({
        FRONTEND_URL: 'woosh-frontend-staging.vercel.app',
      }).frontendUrl('/verify-email?token=abc'),
    ).toBe(
      'https://woosh-frontend-staging.vercel.app/verify-email?token=abc',
    );
  });
});
