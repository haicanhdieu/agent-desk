import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders exactly one focusable h1 with the title', () => {
    render(<PageHeader title="Runs" />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Runs');
    expect(headings[0]).toHaveAttribute('tabindex', '-1');
  });

  it('renders no actions container when actions is absent', () => {
    const { container } = render(<PageHeader title="Runs" meta={<span>meta</span>} />);
    expect(container.querySelector('[data-page-header-actions]')).toBeNull();
    expect(screen.getByText('meta')).toBeInTheDocument();
  });

  it('renders the actions when given', () => {
    render(<PageHeader title="Runs" actions={<button type="button">New run</button>} />);
    expect(screen.getByRole('button', { name: 'New run' })).toBeInTheDocument();
  });

  it('puts the banner after the h1 in DOM order', () => {
    render(<PageHeader title="Runs" banner={<p>Heads up</p>} />);
    const h1 = screen.getByRole('heading', { level: 1 });
    const banner = screen.getByText('Heads up');
    expect(h1.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a skeleton and no title text while loading', () => {
    const { container } = render(<PageHeader title="Runs" loading />);
    expect(screen.queryByText('Runs')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('h1')).toBeNull();
  });
});
