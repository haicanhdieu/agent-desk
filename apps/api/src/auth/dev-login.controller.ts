import { randomUUID } from 'node:crypto';
import { Controller, Get, Inject, NotFoundException, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { NO_INVITATION_CODE } from '@agentdesk/contracts';
import { account, user, type Db } from '@agentdesk/db';
import { ZodPipe } from '../common/zod-validation';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { AUTH, devPassword, type Auth } from './auth';
import { devSignUp } from './dev-signup';

/** A same-site relative path only: one leading '/', no '//', no backslash, no control characters. */
const RelativePath = z
  .string()
  .max(2048)
  .refine(
    // eslint-disable-next-line no-control-regex -- the point of this check is to reject control characters.
    (p) => p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') && !/[\u0000-\u001f\u007f]/.test(p),
    'redirect must be a relative path starting with a single "/"',
  );

export const DevLoginQuery = z.object({
  handle: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/, 'invalid handle'),
  redirect: RelativePath.default('/'),
});

const RefusalBody = z.object({ code: z.string() });

/** True when a failed better-auth response is the sign-up gate's refusal (JSON `code` is `no_invitation`). */
async function isNoInvitation(response: Response): Promise<boolean> {
  try {
    const parsed = RefusalBody.safeParse(await response.clone().json());
    return parsed.success && parsed.data.code === NO_INVITATION_CODE;
  } catch {
    return false;
  }
}

/** Dev only: `GET /auth/dev-login?handle=alice&redirect=/`. Disabled (404) unless AUTH_DEV_LOGIN and not production. */
@Controller('auth')
export class DevLoginController {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get('dev-login')
  async login(@Query() rawQuery: unknown, @Res() reply: FastifyReply): Promise<void> {
    // Gate first: when disabled the route must look absent, whatever the query holds.
    if (!this.config.AUTH_DEV_LOGIN || this.config.NODE_ENV === 'production') throw new NotFoundException('Not found');
    const query = new ZodPipe(DevLoginQuery).transform(rawQuery);
    const handle = query.handle.toLowerCase();
    const email = `${handle}@dev.local`;
    const password = devPassword(this.config, email);

    // Dev accounts have no mailbox: an existing one created before this was done is marked verified first, so the
    // sign-in hooks (which read the stored flag) already see it. New accounts are marked by the sign-up path below.
    await this.markVerified(email);
    let response = await this.auth.api.signInEmail({ body: { email, password }, asResponse: true });
    if (!response.ok) {
      response = await devSignUp.run(true, () =>
        this.auth.api.signUpEmail({ body: { email, password, name: handle }, asResponse: true }),
      );
    }
    if (!response.ok) {
      if (await isNoInvitation(response)) {
        // The sign-in page shows the no-invitation message for this code; no cookie is sent and no user row exists.
        void reply.redirect(`/sign-in?error=${NO_INVITATION_CODE}`, 302);
        return;
      }
      throw new UnauthorizedException('Dev login failed');
    }
    await this.markVerified(email);
    await this.linkFakeAccount(email, handle);
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) void reply.header('set-cookie', cookies);
    void reply.redirect(query.redirect, 302);
  }

  private async markVerified(email: string): Promise<void> {
    await this.db.orm.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  }

  /** Dev only: links a `fake` provider account (account id = handle) so fake-provider comments map to this user. */
  private async linkFakeAccount(email: string, handle: string): Promise<void> {
    const orm = this.db.orm;
    const [row] = await orm.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    if (!row) return;
    const linked = await orm
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, row.id), eq(account.providerId, 'fake'), eq(account.accountId, handle)))
      .limit(1);
    if (linked.length > 0) return;
    await orm
      .insert(account)
      .values({ id: randomUUID(), userId: row.id, providerId: 'fake', accountId: handle, updatedAt: sql`now()` });
  }
}
