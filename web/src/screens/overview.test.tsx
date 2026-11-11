import { render, screen, within } from '@testing-library/react';
import { Overview } from './Overview';

describe('Overview', () => {
  it('is one main with the title and 23 screen links', () => {
    const { container } = render(<Overview />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Proof-of-concept screens' })).toBeInTheDocument();
    const links = within(screen.getByRole('main')).getAllByRole('link');
    expect(links).toHaveLength(23);
    expect(screen.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute('href', '?path=/story/screens-entry--sign-in');
    expect(container.querySelectorAll('[title^="status: "]')).toHaveLength(8);
  });

  it('shows swatch values read from tokens.css', () => {
    render(<Overview />);
    expect(screen.getByText('#15181E')).toBeInTheDocument();
    expect(screen.getByText('#0F1216')).toBeInTheDocument();
  });
});
