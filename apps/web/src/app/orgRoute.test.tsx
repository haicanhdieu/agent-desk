import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

describe('org layout route loads the session access', () => {
  it('a member with no role still sees the no-access state (BR-44)', async () => {
    await renderRoute('/o/alice/projects', {
      scenario: () => {
        server.use(
          http.get('*/api/me/access', () => HttpResponse.json({ userId: 'u', platformAdmin: false, assignments: [] })),
        );
        scenarios.problem('projects.list', { status: 403, title: 'Forbidden', type: 'forbidden' });
      },
    });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
  });

  it('a failing access fetch shows the retryable error state, not a crash', async () => {
    await renderRoute('/o/alice/projects', { scenario: () => scenarios.serverError('me.access') });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
