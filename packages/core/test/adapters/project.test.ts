import { describe, expect, it } from 'vitest';
import { browserRepoUrl } from '../../src/adapters/project';

describe('browserRepoUrl', () => {
  it('turns a provider clone URL into the repository home URL', () => {
    expect(browserRepoUrl('https://github.com/acme/widgets.git')).toBe('https://github.com/acme/widgets');
  });

  it('keeps a self-hosted path prefix', () => {
    expect(browserRepoUrl('https://git.example.com/teams/acme/widgets.git')).toBe(
      'https://git.example.com/teams/acme/widgets',
    );
  });

  it('strips a trailing slash before the .git suffix', () => {
    expect(browserRepoUrl('https://github.com/acme/widgets.git/')).toBe('https://github.com/acme/widgets');
  });

  it('refuses clone URLs with credentials or a non-https scheme', () => {
    expect(browserRepoUrl('https://token@github.com/acme/widgets.git')).toBeNull();
    expect(browserRepoUrl('http://github.com/acme/widgets.git')).toBeNull();
    expect(browserRepoUrl('not a url')).toBeNull();
  });
});
