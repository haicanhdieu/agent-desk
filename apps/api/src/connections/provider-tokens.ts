import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { account, type Db } from '@agentdesk/db';
import { ProviderReauthRequiredError, type Clock } from '@agentdesk/core';
import { AUTH, type Auth } from '../auth/auth';
import { CLOCK } from '../common/clock';
import { DB } from '../db/db.module';

/**
 * The user's own OAuth token at a provider (their linked sign-in account), always one that is usable now.
 *
 * Provider user tokens expire (GitHub: after 8 hours) while the Agent Desk session lasts longer, so the stored token
 * is read through better-auth's `getAccessToken`, which refreshes an expired one with the stored refresh token and
 * saves the new pair. The user id always comes from the verified session (or the install state bound to it): a token is
 * only ever read for that one user. Tokens are returned to the caller only; they are never logged.
 */
@Injectable()
export class ProviderTokens {
  private readonly logger = new Logger(ProviderTokens.name);
  /** Providers rotate refresh tokens, so two refreshes at once can make one fail: share one per user and provider. */
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * A usable token for `userId`'s linked `provider` account, or null when the user has no such account (or one that stores no tokens).
   * Throws `ProviderReauthRequiredError` when the account holds a token that is no longer usable and none can be got:
   * an expired token without a refresh token, or a refresh the provider refused (revoked or expired refresh token).
   */
  userToken(userId: string, provider: string): Promise<string | null> {
    const key = `${userId}:${provider}`;
    const running = this.inFlight.get(key);
    if (running) return running;
    const started = this.load(userId, provider).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, started);
    return started;
  }

  private async load(userId: string, provider: string): Promise<string | null> {
    const rows = await this.db.orm
      .select({ id: account.id, accessToken: account.accessToken, refreshToken: account.refreshToken })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, provider)))
      .limit(1);
    const row = rows[0];
    // A linked account that stores no token at all (e.g. the dev-only fake provider link) is not usable for the
    // provider's API: treat it as not linked, as before. Only the presence is read here; token values are not used.
    if (!row || (!row.accessToken && !row.refreshToken)) return null;

    let tokens: { accessToken?: string | undefined; accessTokenExpiresAt?: Date | string | undefined };
    try {
      tokens = await this.auth.api.getAccessToken({ body: { accountId: row.id, userId } });
    } catch (err) {
      // better-auth reports every failure (refused refresh, network, bad stored token) as one generic 400 and keeps
      // no cause, so a provider outage cannot be told from a dead refresh token here: the user is asked to reconnect.
      this.logger.warn(
        `provider token unavailable provider=${provider} err=${err instanceof Error ? err.name : 'error'}`,
      );
      throw new ProviderReauthRequiredError();
    }
    const { accessToken, accessTokenExpiresAt } = tokens;
    // better-auth only refreshes when it holds a refresh token; without one it hands back the stale token.
    const expired = accessTokenExpiresAt !== undefined && new Date(accessTokenExpiresAt) <= this.clock.now();
    if (!accessToken || expired) throw new ProviderReauthRequiredError();
    return accessToken;
  }
}
