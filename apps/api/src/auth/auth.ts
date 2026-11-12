import { createHmac, randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization as organizationPlugin } from 'better-auth/plugins';
import { asc, eq, sql } from 'drizzle-orm';
import { account, invitation, member, organization, session, user, verification, type Db } from '@agentdesk/db';
import type { Config } from '../config/config.schema';
import { slugFromHandle } from './slug';

export const AUTH = Symbol('AUTH');

const schema = { user, session, account, verification, organization, member, invitation };

const MAX_SLUG_ATTEMPTS = 5;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === '23505';
}

/** Dev-login accounts are not guessable from outside: the password is an HMAC of the email under the server secret. */
export function devPassword(config: Pick<Config, 'BETTER_AUTH_SECRET'>, email: string): string {
  return createHmac('sha256', config.BETTER_AUTH_SECRET).update(`dev-login:${email}`).digest('hex');
}

function handleFromEmail(email: string): string {
  return email.split('@')[0] || 'user';
}

export function createAuth(config: Config, db: Db) {
  const orm = db.orm;
  const github =
    config.GITHUB_CLIENT_ID !== undefined && config.GITHUB_CLIENT_SECRET !== undefined
      ? {
          github: {
            clientId: config.GITHUB_CLIENT_ID,
            clientSecret: config.GITHUB_CLIENT_SECRET,
            mapProfileToUser: (profile: { login: string }) => ({ handle: profile.login }),
          },
        }
      : {};

  /**
   * Idempotent: creates the personal org and owner membership unless the user already belongs to an org. Called from
   * user.create.after and, because better-auth may run `after` hooks once the first session is already being
   * created, also from session.create.before. A per-user advisory lock serialises the two.
   */
  async function ensurePersonalOrg(userId: string, handle: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      try {
        return await orm.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
          const existing = await tx
            .select({ organizationId: member.organizationId })
            .from(member)
            .where(eq(member.userId, userId))
            .orderBy(asc(member.createdAt))
            .limit(1);
          if (existing[0]) return existing[0].organizationId;
          const slug = await slugFromHandle(handle, async (s) => {
            const rows = await tx
              .select({ id: organization.id })
              .from(organization)
              .where(eq(organization.slug, s))
              .limit(1);
            return rows.length > 0;
          });
          // organization.id doubles as app tables' org_id (uuid, no FK), hence randomUUID.
          const orgId = randomUUID();
          const now = new Date();
          await tx.insert(organization).values({ id: orgId, name: handle, slug, createdAt: now });
          await tx
            .insert(member)
            .values({ id: randomUUID(), organizationId: orgId, userId, role: 'owner', createdAt: now });
          return orgId;
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    throw new Error('could not allocate a personal organization slug');
  }

  return betterAuth({
    baseURL: config.PUBLIC_ORIGIN,
    basePath: '/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.PUBLIC_ORIGIN],
    database: drizzleAdapter(orm, { provider: 'pg', schema }),
    // Ids double as uuid org ids for organizations, so every generated id is a uuid.
    advanced: { database: { generateId: () => randomUUID() } },
    emailAndPassword: { enabled: config.AUTH_DEV_LOGIN && config.NODE_ENV !== 'production', autoSignIn: true },
    socialProviders: github,
    user: { additionalFields: { handle: { type: 'string', required: false, input: false } } },
    plugins: [organizationPlugin({ allowUserToCreateOrganization: false })],
    databaseHooks: {
      user: {
        create: {
          before: async (u) => {
            const handle =
              'handle' in u && typeof u.handle === 'string' && u.handle !== '' ? u.handle : handleFromEmail(u.email);
            return { data: { ...u, handle } };
          },
          after: async (u) => {
            const row = await orm.select({ handle: user.handle }).from(user).where(eq(user.id, u.id)).limit(1);
            await ensurePersonalOrg(u.id, row[0]?.handle ?? handleFromEmail(u.email));
          },
        },
      },
      session: {
        create: {
          before: async (s) => {
            const rows = await orm.select({ handle: user.handle }).from(user).where(eq(user.id, s.userId)).limit(1);
            const activeOrganizationId = await ensurePersonalOrg(s.userId, rows[0]?.handle ?? 'user');
            return { data: { ...s, activeOrganizationId } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
