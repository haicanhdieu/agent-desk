import { createHmac, randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization as organizationPlugin } from 'better-auth/plugins';
import { asc, eq } from 'drizzle-orm';
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
import { acceptPendingInvitations } from './accept-invitations';
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

  /** Reads the stored email and verified flag (never the hook's copy), then applies the user's pending invitations. */
  async function acceptInvitationsFor(userId: string): Promise<void> {
    const [row] = await orm
      .select({ email: user.email, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (row) await acceptPendingInvitations(db, { id: userId, email: row.email, emailVerified: row.emailVerified });
  }

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
   * or is a configured platform admin address. Anything else (including a failed lookup) throws, so no user row is
   * written. The refusal never says which of the two checks failed.
   */
  async function assertMaySignUp(candidate: { email: string; emailVerified?: boolean | null }): Promise<void> {
    const refuse = () => new APIError('FORBIDDEN', { message: 'Sign-up needs an invitation' });
    const verified = devSignUp.getStore() === true || candidate.emailVerified === true;
    if (!verified) throw refuse();
    const email = candidate.email.trim().toLowerCase();
    if (email === '') throw refuse();
    if (isPlatformAdmin(config, { email, emailVerified: true })) return;
    const pending = await pendingInvitationsForEmail(db, email);
    if (pending.length === 0) throw refuse();
  }

  return betterAuth({
    baseURL: config.PUBLIC_ORIGIN,
    basePath: '/auth',
    secret: config.BETTER_AUTH_SECRET,
    disabledPaths: DISABLED_PATHS,
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
            await assertMaySignUp(u);
            const handle =
              'handle' in u && typeof u.handle === 'string' && u.handle !== '' ? u.handle : handleFromEmail(u.email);
            return { data: devSignUp.getStore() === true ? { ...u, handle, emailVerified: true } : { ...u, handle } };
          },
          after: async (u) => {
            await acceptInvitationsFor(u.id);
          },
        },
      },
      session: {
        create: {
          before: async (s) => {
            await acceptInvitationsFor(s.userId);
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
