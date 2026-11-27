import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepoBlock } from './RepoBlock';

const base = { owner: 'harbor-labs', name: 'invoicer-api', branch: 'main', repoUrl: 'https://example.com/r' };

describe('RepoBlock', () => {
  it('shows the heading, owner, name and branch', () => {
    render(<RepoBlock {...base} />);
    expect(screen.getByText('Repository')).toBeInTheDocument();
    expect(screen.getByText(/harbor-labs/)).toBeInTheDocument();
    expect(screen.getByText('invoicer-api')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('omits the branch line when there is no branch', () => {
    render(<RepoBlock {...base} branch={null} />);
    expect(screen.queryByText('main')).toBeNull();
  });

  it.each([
    ['ok', 'Connected'],
    ['warn', 'Webhooks silent'],
    ['err', 'Polling failed'],
  ] as const)('shows the %s status text', (tone, text) => {
    render(<RepoBlock {...base} status={{ tone, text }} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('links to the repository in a new tab', () => {
    render(<RepoBlock {...base} />);
    const link = screen.getByRole('link', { name: 'Open repository' });
    expect(link).toHaveAttribute('href', 'https://example.com/r');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });
});
