import { Controller, Get, Inject, NotFoundException, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-validation';
import { CONFIG, type Config } from '../config/config.module';
import { AUTH, devPassword, type Auth } from './auth';

/** A same-site relative path only: one leading '/', no '//', no backslash, no control characters. */
const RelativePath = z
  .string()
  .max(2048)
  .refine(
    (p) => p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') && !/[\u0000-\u001f\u007f]/.test(p),
    'redirect must be a relative path starting with a single "/"',
  );

export const DevLoginQuery = z.object({
  handle: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/, 'invalid handle'),
  redirect: RelativePath.default('/'),
});

/** Dev only: `GET /auth/dev-login?handle=alice&redirect=/`. Disabled (404) unless AUTH_DEV_LOGIN and not production. */
@Controller('auth')
export class DevLoginController {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get('dev-login')
  async login(
    @Query(new ZodPipe(DevLoginQuery)) query: z.output<typeof DevLoginQuery>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!this.config.AUTH_DEV_LOGIN || this.config.NODE_ENV === 'production') throw new NotFoundException('Not found');
    const handle = query.handle.toLowerCase();
    const email = `${handle}@dev.local`;
    const password = devPassword(this.config, email);

    let response = await this.auth.api.signInEmail({ body: { email, password }, asResponse: true });
    if (!response.ok) {
      response = await this.auth.api.signUpEmail({ body: { email, password, name: handle }, asResponse: true });
    }
    if (!response.ok) throw new UnauthorizedException('Dev login failed');
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) void reply.header('set-cookie', cookies);
    void reply.redirect(query.redirect, 302);
  }
}
