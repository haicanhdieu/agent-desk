import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Set while dev-login signs a dev account up: the `user.create.before` hook then stores the account as email-verified
 * (dev accounts have no mailbox, and platform-admin and invitation flows need a verified email). Never entered outside
 * the dev-login controller, which is 404 unless AUTH_DEV_LOGIN is on and NODE_ENV is not production.
 */
export const devSignUp = new AsyncLocalStorage<true>();
