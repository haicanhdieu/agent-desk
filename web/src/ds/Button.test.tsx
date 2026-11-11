import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from './Button';

describe('Button', () => {
  it('renders a button with its name', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('adds the variant class', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn', 'danger');
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link when href is set', () => {
    render(<Button href="/x">Open</Button>);
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/x');
  });

  it('renders a disabled button instead of a link when disabled with href', () => {
    render(<Button href="/x" disabled>Open</Button>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
  });

  it('renders iconRight after the text', () => {
    render(<Button iconRight="chevron-right">Next</Button>);
    const btn = screen.getByRole('button', { name: 'Next' });
    expect(btn.lastElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(btn.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  });

  it('passes aria-pressed through', () => {
    render(<Button aria-pressed={true}>Grouped by ticket</Button>);
    expect(screen.getByRole('button', { name: 'Grouped by ticket' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('IconButton', () => {
  it('uses aria-label as its name and the iconbtn class', () => {
    render(<IconButton icon="x" aria-label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('btn', 'iconbtn');
  });

  it('requires aria-label at the type level', () => {
    // @ts-expect-error aria-label is required
    render(<IconButton icon="x" />);
  });
});
