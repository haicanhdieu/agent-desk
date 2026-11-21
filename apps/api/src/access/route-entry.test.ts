import { describe, expect, it } from 'vitest';
import { routeAccess } from '@agentdesk/contracts';
import { routeEntryFor } from './route-entry';

describe('routeEntryFor', () => {
  it('finds a route by method and Fastify url', () => {
    expect(routeEntryFor('GET', '/api/projects/:projectId')).toEqual({
      kind: 'route',
      key: 'projects.get',
      entry: routeAccess['projects.get'],
    });
  });
  it('tells methods apart on one url', () => {
    expect(routeEntryFor('PATCH', '/api/projects/:projectId')).toMatchObject({ kind: 'route', key: 'projects.update' });
    expect(routeEntryFor('DELETE', '/api/projects/:projectId')).toMatchObject({
      kind: 'route',
      key: 'projects.remove',
    });
  });
  it('is case-insensitive on the method', () => {
    expect(routeEntryFor('get', '/api/projects/:projectId')).toMatchObject({ key: 'projects.get' });
  });
  it('answers HEAD from the GET entry only', () => {
    expect(routeEntryFor('HEAD', '/api/projects/:projectId')).toMatchObject({ kind: 'route', key: 'projects.get' });
    expect(routeEntryFor('HEAD', '/api/runs/:runId/cancel')).toEqual({ kind: 'unknown' });
  });
  it('maps the install callback to connections.install', () => {
    expect(routeEntryFor('GET', '/api/connections/:provider/callback')).toEqual({
      kind: 'route',
      key: 'connections.install',
      entry: routeAccess['connections.install'],
    });
  });
  it('sends /dev routes to the dev kind', () => {
    expect(routeEntryFor('POST', '/dev/fake/comments')).toEqual({ kind: 'dev' });
  });
  it('treats an unlisted /api url as unknown', () => {
    expect(routeEntryFor('GET', '/api/nope')).toEqual({ kind: 'unknown' });
    expect(routeEntryFor('POST', '/api/projects/:projectId')).toEqual({ kind: 'unknown' });
  });
  it('does not treat a url that only starts with /dev as dev', () => {
    expect(routeEntryFor('GET', '/devious')).toEqual({ kind: 'unknown' });
  });
});
