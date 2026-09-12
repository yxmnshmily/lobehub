/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNodeRequest: vi.fn(),
  createNodeResponse: vi.fn(),
  middleware: vi.fn(),
  providerCallback: vi.fn(),
}));

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    ENABLE_OIDC: true,
  },
}));

vi.mock('@/libs/oidc-provider/http-adapter', () => ({
  createNodeRequest: mocks.createNodeRequest,
  createNodeResponse: mocks.createNodeResponse,
}));

vi.mock('@/server/services/oidc/oidcProvider', () => ({
  getOIDCProvider: vi.fn(async () => ({
    callback: mocks.providerCallback,
  })),
}));

describe('OIDC route', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.providerCallback.mockReturnValue(mocks.middleware);
    mocks.createNodeResponse.mockReturnValue({
      nodeResponse: {},
      responseBody: '',
      responseHeaders: {},
      responseStatus: 200,
    });
  });

  it('returns a 500 response when creating the Node request fails', async () => {
    mocks.createNodeRequest.mockRejectedValueOnce(new Error('body stream aborted'));

    const { POST } = await import('./route');
    const request = new Request('https://example.com/oidc/token', {
      body: 'grant_type=refresh_token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    }) as unknown as NextRequest;

    const response = await Promise.race([
      POST(request),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OIDC route timed out')), 50),
      ),
    ]);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('body stream aborted');
    expect(mocks.middleware).not.toHaveBeenCalled();
  });

  it('keeps signed interaction cookies as separate Set-Cookie headers', async () => {
    const cookies = [
      '_interaction=example; Path=/; HttpOnly; SameSite=Lax',
      '_interaction.sig=signature; Path=/; HttpOnly; SameSite=Lax',
      '_interaction_resume=example; Path=/oidc/device/example; HttpOnly; SameSite=Lax',
      '_interaction_resume.sig=signature; Path=/oidc/device/example; HttpOnly; SameSite=Lax',
    ];
    mocks.createNodeRequest.mockResolvedValueOnce({});
    mocks.createNodeResponse.mockReturnValueOnce({
      nodeResponse: {},
      responseBody: '',
      responseHeaders: { 'location': '/oauth/consent/example', 'set-cookie': cookies },
      responseStatus: 303,
    });
    mocks.middleware.mockImplementationOnce((_req, _res, next) => next());

    const { POST } = await import('./route');
    const response = await POST(
      new Request('https://example.com/oidc/device', {
        method: 'POST',
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie()).toEqual(cookies);
    expect(response.headers.get('location')).toBe('/oauth/consent/example');
  });
});
