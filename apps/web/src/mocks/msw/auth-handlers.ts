import { HttpResponse, http, type HttpHandler } from 'msw';
import { z } from 'zod';
import { mockDb } from './db';

// better-auth endpoints the web app's auth client calls (createAuthClient({ baseURL, basePath: '/auth',
// plugins: [organizationClient()] })). Shapes follow better-auth 1.7 (api/routes/session.mjs, sign-in.mjs,
// sign-out.mjs, plugins/organization/routes/crud-org.mjs): get-session answers 200 with `null` when signed out; the
// organization routes answer 401 without a session; errors are `{ code, message }`. The social sign-in skips the
// OAuth round trip: it signs alice in and returns the callback URL as the redirect target.

const Iso = z.iso.datetime({ offset: true });

export const AuthUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  handle: z.string(),
  createdAt: Iso,
  updatedAt: Iso,
});

export const AuthSession = z.object({
  id: z.string(),
  token: z.string(),
  userId: z.string(),
  expiresAt: Iso,
  createdAt: Iso,
  updatedAt: Iso,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  activeOrganizationId: z.string().nullable(),
});

export const GetSessionResponse = z.object({ session: AuthSession, user: AuthUser }).nullable();

export const AuthOrganization = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  metadata: z.string().nullable(),
  createdAt: Iso,
});

const AuthError = z.object({ code: z.string(), message: z.string() });

const SetActiveBody = z.object({
  organizationId: z.string().nullable().optional(),
  organizationSlug: z.string().optional(),
});

const SocialSignInBody = z.object({
  provider: z.string(),
  callbackURL: z.string().optional(),
  disableRedirect: z.boolean().optional(),
});

const authError = (status: number, code: string, message: string) =>
  HttpResponse.json(AuthError.parse({ code, message }), { status });

async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const log = (request: Request) => mockDb.logRequest(request.method, new URL(request.url).pathname);

export const authHandlers: HttpHandler[] = [
  http.get('/auth/get-session', ({ request }) => {
    log(request);
    const user = mockDb.currentUser();
    if (!user) return HttpResponse.json(GetSessionResponse.parse(null));
    const at = user.updatedAt;
    return HttpResponse.json(
      GetSessionResponse.parse({
        session: {
          id: 'session-mock',
          token: 'session-mock-token',
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          createdAt: at,
          updatedAt: at,
          ipAddress: null,
          userAgent: null,
          activeOrganizationId: mockDb.auth.activeOrganizationId,
        },
        user,
      }),
    );
  }),

  http.get('/auth/organization/list', ({ request }) => {
    log(request);
    const user = mockDb.currentUser();
    if (!user) return authError(401, 'UNAUTHORIZED', 'Unauthorized');
    return HttpResponse.json(z.array(AuthOrganization).parse(mockDb.orgsOf(user.id)));
  }),

  http.post('/auth/organization/set-active', async ({ request }) => {
    log(request);
    const user = mockDb.currentUser();
    if (!user) return authError(401, 'UNAUTHORIZED', 'Unauthorized');
    const body = SetActiveBody.safeParse(await jsonBody(request));
    if (!body.success) return authError(400, 'VALIDATION_ERROR', 'Invalid body');
    const { organizationId, organizationSlug } = body.data;
    if (organizationId === null) {
      mockDb.setActiveOrg(null);
      return HttpResponse.json(null);
    }
    const org = mockDb.state.orgs.find((o) =>
      organizationId !== undefined ? o.id === organizationId : o.slug === organizationSlug,
    );
    if (!org && organizationId === undefined) {
      return authError(400, 'ORGANIZATION_NOT_FOUND', 'Organization not found');
    }
    if (!org || !mockDb.orgsOf(user.id).some((o) => o.id === org.id)) {
      return authError(403, 'USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION', 'You are not a member of this organization');
    }
    mockDb.setActiveOrg(org.id);
    return HttpResponse.json(AuthOrganization.parse(org));
  }),

  http.post('/auth/sign-in/social', async ({ request }) => {
    log(request);
    const body = SocialSignInBody.safeParse(await jsonBody(request));
    if (!body.success) return authError(400, 'VALIDATION_ERROR', 'Invalid body');
    mockDb.signIn();
    return HttpResponse.json({ url: body.data.callbackURL ?? '/', redirect: body.data.disableRedirect !== true });
  }),

  http.post('/auth/sign-out', ({ request }) => {
    log(request);
    mockDb.signOut();
    return HttpResponse.json({ success: true });
  }),
];
