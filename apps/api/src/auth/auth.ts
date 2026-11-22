import { createHmac, randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization as organizationPlugin } from 'better-auth/plugins';
import { and, asc, eq } from 'drizzle-orm';
import { NO_INVITATION_CODE } from '@agentdesk/contracts';
import {
  account,
  invitation,
  member,
  organization,
  pendingInvitationsForEmail,
  session,
  user,
  verification,
  type Db,
} from '@agentdesk/db';
import { isPlatformAdmin } from '../access/platform-admin';
import type { Config } from '../config/config.schema';
import { devSignUp } from './dev-signup';

export const AUTH = Symbol('AUTH');

const schema = { user, session, account, verification, organization, member, invitation };

/** Never reachable over HTTP: dev-login uses auth.api directly, which skips the router. */
export const DISABLED_PATHS = [
  '/sign-in/email',
  '/sign-up/email',
  '/organization/create',
  '/organization/update',
  '/organization/delete',
  '/organization/invite-member',
  '/organization/remove-member',
  '/organization/leave',
  '/organization/update-member-role',
  '/organization/cancel-invitation',
  '/organization/accept-invitation',
  '/organization/reject-invitation',
];

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

  /** The oldest membership: the org a session starts in. */
  async function oldestMembership(userId: string): Promise<string | null> {
    const rows = await orm
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .orderBy(asc(member.createdAt), asc(member.organizationId))
      .limit(1);
    return rows[0]?.organizationId ?? null;
  }

  /**
   * The sign-up gate. An account is created only for a verified email that either has a pending, unexpired invitation
   * or has a `platform_admins` entry. Anything else (including a failed lookup) throws, so no user row is
   * written. The refusal carries `NO_INVITATION_CODE`, which the sign-in page matches, and never says which of the
   * two checks failed.
   */
  async function assertMaySignUp(candidate: { email: string; emailVerified?: boolean | null }): Promise<void> {
    const refuse = () =>
      new APIError('FORBIDDEN', { message: 'Sign-up needs an invitation', code: NO_INVITATION_CODE });
    const verified = devSignUp.getStore() === true || candidate.emailVerified === true;
    if (!verified) throw refuse();
    const email = candidate.email.trim().toLowerCase();
    if (email === '') throw refuse();
    if (await isPlatformAdmin(db, { email, emailVerified: true })) return;
    const pending = await pendingInvitationsForEmail(db, email);
    if (pending.length === 0) throw refuse();
  }

  const orgPlugin = organizationPlugin({ allowUserToCreateOrganization: false });

  return betterAuth({
    baseURL: config.PUBLIC_ORIGIN,
    basePath: '/auth',
    secret: config.BETTER_AUTH_SECRET,
    disabledPaths: DISABLED_PATHS,
    hooks: {
      // better-auth clears the session's active org before it refuses a non-member; refuse first so the session stays as it was.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/organization/set-active') return;
        const body: unknown = ctx.body;
        if (typeof body !== 'object' || body === null) return;
        // Mirror better-auth's target choice: a null id only clears the active org, a non-empty id wins over the slug.
        const id = 'organizationId' in body ? body.organizationId : undefined;
        const slug = 'organizationSlug' in body ? body.organizationSlug : undefined;
        if (id === null) return;
        let targetId: string | undefined;
        if (typeof id === 'string' && id !== '') {
          targetId = id;
        } else if (typeof slug === 'string' && slug !== '') {
          const [bySlug] = await orm
            .select({ id: organization.id })
            .from(organization)
            .where(eq(organization.slug, slug))
            .limit(1);
          // An unknown slug is the library's plain 400 and changes nothing.
          targetId = bySlug?.id;
        }
        const current = await getSessionFromCtx(ctx);
        if (!current) return;
        // With neither id nor slug the library falls back to the session's active org and clears it on refusal.
        if ((id === undefined || id === '') && (slug === undefined || slug === '')) {
          targetId = current.session.activeOrganizationId ?? undefined;
        }
        if (targetId === undefined) return;
        const [m] = await orm
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.userId, current.user.id), eq(member.organizationId, targetId)))
          .limit(1);
        if (!m) throw APIError.from('FORBIDDEN', orgPlugin.$ERROR_CODES.USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION);
      }),
    },
    trustedOrigins: [config.PUBLIC_ORIGIN],
    database: drizzleAdapter(orm, { provider: 'pg', schema }),
    // Ids double as uuid org ids for organizations, so every generated id is a uuid.
    advanced: { database: { generateId: () => randomUUID() } },
    emailAndPassword: { enabled: config.AUTH_DEV_LOGIN && config.NODE_ENV !== 'production', autoSignIn: true },
    socialProviders: github,
    user: { additionalFields: { handle: { type: 'string', required: false, input: false } } },
    plugins: [orgPlugin],
    databaseHooks: {
      user: {
        create: {
          before: async (u) => {
            await assertMaySignUp(u);
            const handle =
              'handle' in u && typeof u.handle === 'string' && u.handle !== '' ? u.handle : handleFromEmail(u.email);
            return { data: devSignUp.getStore() === true ? { ...u, handle, emailVerified: true } : { ...u, handle } };
          },
        },
      },
      session: {
        create: {
          before: async (s) => {
            // The oldest membership, or none: a platform admin with no org, or a user nobody has granted yet.
            const activeOrganizationId = await oldestMembership(s.userId);
            return { data: { ...s, activeOrganizationId } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
