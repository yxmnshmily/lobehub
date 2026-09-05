import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` }));

const fail = (message: string): never => {
  console.error(`Platform administrator check failed: ${message}`);
  process.exit(1);
};

const main = async () => {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not configured');

  const mode = process.argv[2] || 'check';
  if (!['bootstrap', 'check', 'startup'].includes(mode)) {
    fail('mode must be bootstrap, check or startup');
  }

  const { serverDB } = await import('../../packages/database/src/server');
  const { bootstrapPlatformAdmin, getActivePlatformAdminCount } =
    await import('../../packages/database/src/models/platformAdmin');

  if (mode === 'bootstrap') {
    const userId = process.env.PLATFORM_ADMIN_USER_ID;
    if (!userId || userId.length > 255 || userId.trim() !== userId) {
      fail('set PLATFORM_ADMIN_USER_ID to the exact existing user ID for this one command');
    }

    await bootstrapPlatformAdmin(serverDB, userId);
    console.log('Platform administrator role is assigned and persisted.');
  }

  const count = await getActivePlatformAdminCount(serverDB);
  if (count === 0) {
    if (mode === 'startup') {
      const existingUser = await serverDB.query.users.findFirst({ columns: { id: true } });
      if (!existingUser) {
        console.warn(
          'No users exist yet. Startup may continue for initial registration; platform settings remain locked until an explicit administrator bootstrap is completed.',
        );
        return;
      }
    }

    fail(
      'no active global super_admin exists. Run PLATFORM_ADMIN_USER_ID=<exact-user-id> bun run platform-admin:bootstrap, then remove the environment variable.',
    );
  }

  console.log(
    `Platform administrator check passed (${count} active assignment${count === 1 ? '' : 's'}).`,
  );
};

void main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
