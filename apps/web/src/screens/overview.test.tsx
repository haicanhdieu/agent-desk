import { render, screen, within } from '@testing-library/react';
import { Overview } from './Overview';

describe('Overview', () => {
  it('is one main with the title and 24 screen links', () => {
    const { container } = render(<Overview />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Proof-of-concept screens' })).toBeInTheDocument();
    const links = within(screen.getByRole('main')).getAllByRole('link');
    expect(links).toHaveLength(24);
    expect(screen.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
      'href',
      '?path=/story/screens-entry--sign-in',
    );
    for (const a of links) expect(a).toHaveAttribute('target', '_top');
    expect(container.querySelectorAll('[title^="status: "]')).toHaveLength(11);
  });

  it('labels the second setup link "2. Agent" and points it at the agent step board', () => {
    render(<Overview />);
    expect(screen.getByRole('link', { name: '2. Agent' })).toHaveAttribute(
      'href',
      '?path=/story/screens-setup--setup-2-default-agent',
    );
    expect(screen.queryByRole('link', { name: '2. Claude credential' })).toBeNull();
  });

  it('shows swatch values read from tokens.css', () => {
    render(<Overview />);
    expect(screen.getByText('#15181e')).toBeInTheDocument();
    expect(screen.getByText('#0f1216')).toBeInTheDocument();
  });
});
