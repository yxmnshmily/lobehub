import app from '@/server/router-hono/websiteAi';

const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
