import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import {
  getWebsiteAiGenerationStatus,
  getWebsiteAiSession,
  startWebsiteAiChat,
  trustedWebsiteAiOrigin,
} from './handlers/chat';

const app = new Hono().basePath('/api/website-ai');
const PRIVATE_CACHE_CONTROL = 'private, no-store, no-cache, max-age=0, no-transform';
const WEBSITE_AI_ALLOWED_HEADERS = 'Content-Type, Idempotency-Key, Last-Event-ID';

app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', PRIVATE_CACHE_CONTROL);
  c.header('Expires', '0');
  c.header('Pragma', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
  const vary = new Set(
    (c.res.headers.get('Vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  vary.add('Origin');
  vary.add('Cookie');
  c.header('Vary', [...vary].join(', '));
});

app.use('*', async (c, next) => {
  const trustedOrigin = trustedWebsiteAiOrigin(c.req.raw);
  if (c.req.method === 'OPTIONS') {
    if (!trustedOrigin) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Request origin rejected' } }, 403);
    }
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Headers', WEBSITE_AI_ALLOWED_HEADERS);
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Origin', trustedOrigin);
    c.header('Vary', 'Access-Control-Request-Headers', { append: true });
    return c.body(null, 204);
  }

  await next();
  if (trustedOrigin) {
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Origin', trustedOrigin);
  }
});

const websiteAiJsonBodyLimit = bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) =>
    c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } }, 413),
});

app.post('/chat', websiteAiJsonBodyLimit, startWebsiteAiChat);
app.post('/generation/status', websiteAiJsonBodyLimit, getWebsiteAiGenerationStatus);
app.get('/session', getWebsiteAiSession);

export default app;
