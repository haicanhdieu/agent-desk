import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { skillPreviewSamples } from '@/mocks';
import { SkillPreviewPane, type SkillPreviewModule } from './SkillPreviewPane';

function Throws(): never {
  throw new Error('render failed');
}

describe('SkillPreviewPane', () => {
  it('shows a text Skeleton with a loading status while the preview loads', () => {
    render(<SkillPreviewPane value="x" load={() => new Promise(() => {})} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the preview');
  });

  it('shows the preview once loaded', async () => {
    render(<SkillPreviewPane value={skillPreviewSamples.table} />);
    expect(await screen.findByRole('region', { name: 'Skill preview' })).toBeInTheDocument();
  });

  it('shows "Could not show the preview" when the module fails to load', async () => {
    render(<SkillPreviewPane value="x" load={() => Promise.reject(new Error('chunk failed'))} />);
    expect(await screen.findByText('Could not show the preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows the error state when rendering throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SkillPreviewPane value="x" load={() => Promise.resolve({ default: Throws })} />);
    expect(await screen.findByText('Could not show the preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('Try again loads the preview again after a failed load', async () => {
    const stub: SkillPreviewModule = { default: ({ value }) => <p>{value}</p> };
    const load = vi.fn().mockRejectedValueOnce(new Error('chunk failed')).mockResolvedValue(stub);
    render(<SkillPreviewPane value="hello preview" load={load} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('hello preview')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
