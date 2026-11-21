import { describe, expect, it } from 'vitest';
import { describeRequest } from './audit.interceptor';

describe('describeRequest', () => {
  it('names a listed route by its route-table key and captures the first param', () => {
    expect(describeRequest('PATCH', '/api/projects/p-1')).toEqual({
      action: 'PATCH projects.update',
      targetType: 'projects',
      targetId: 'p-1',
    });
  });

  it('falls back to "METHOD path" with no target id for a route not in the table', () => {
    expect(describeRequest('POST', '/api/not-a-route/x')).toEqual({
      action: 'POST /api/not-a-route/x',
      targetType: 'not-a-route',
      targetId: null,
    });
  });
});
