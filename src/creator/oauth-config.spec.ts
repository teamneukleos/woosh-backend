import { oauthConfiguredFor, oauthRedirectUri } from './oauth-config';

const originalRedirect = process.env.GOOGLE_YOUTUBE_REDIRECT_URI;
const originalApp = process.env.APP_URL;
const originalFrontend = process.env.FRONTEND_URL;
const originalId = process.env.GOOGLE_CLIENT_ID;
const originalSecret = process.env.GOOGLE_CLIENT_SECRET;
const originalComposioKey = process.env.COMPOSIO_API_KEY;
const originalComposioAuth = process.env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID;
const originalComposioCallback = process.env.COMPOSIO_INSTAGRAM_CALLBACK_URL;
const originalMetaId = process.env.META_APP_ID;
const originalMetaSecret = process.env.META_APP_SECRET;

afterEach(() => {
  process.env.GOOGLE_YOUTUBE_REDIRECT_URI = originalRedirect;
  process.env.APP_URL = originalApp;
  process.env.FRONTEND_URL = originalFrontend;
  process.env.GOOGLE_CLIENT_ID = originalId;
  process.env.GOOGLE_CLIENT_SECRET = originalSecret;
  process.env.COMPOSIO_API_KEY = originalComposioKey;
  process.env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID = originalComposioAuth;
  process.env.COMPOSIO_INSTAGRAM_CALLBACK_URL = originalComposioCallback;
  process.env.META_APP_ID = originalMetaId;
  process.env.META_APP_SECRET = originalMetaSecret;
});

describe('oauth-config YouTube', () => {
  it('uses GOOGLE_YOUTUBE_REDIRECT_URI when set', () => {
    process.env.GOOGLE_YOUTUBE_REDIRECT_URI =
      'http://localhost:3000/creators/social/youtube/callback';
    expect(oauthRedirectUri('YOUTUBE')).toBe(
      'http://localhost:3000/creators/social/youtube/callback',
    );
  });

  it('defaults YouTube to the Nest callback', () => {
    delete process.env.GOOGLE_YOUTUBE_REDIRECT_URI;
    process.env.APP_URL = 'http://localhost:4000';
    expect(oauthRedirectUri('YOUTUBE')).toBe(
      'http://localhost:4000/api/creators/social/youtube/callback',
    );
  });

  it('requires both Google client id and secret', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(oauthConfiguredFor('YOUTUBE')).toBe(false);
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    expect(oauthConfiguredFor('YOUTUBE')).toBe(true);
  });
});

describe('oauth-config Instagram', () => {
  it('is configured when Composio keys are present', () => {
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    process.env.COMPOSIO_API_KEY = 'ck_test';
    process.env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID = 'ac_test';
    expect(oauthConfiguredFor('INSTAGRAM')).toBe(true);
  });

  it('defaults the Composio callback to Next', () => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.COMPOSIO_API_KEY = 'ck_test';
    process.env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID = 'ac_test';
    delete process.env.COMPOSIO_INSTAGRAM_CALLBACK_URL;
    expect(oauthRedirectUri('INSTAGRAM')).toBe(
      'http://localhost:3000/creators/social/instagram/callback',
    );
  });
});
