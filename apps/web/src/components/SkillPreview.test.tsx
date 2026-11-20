import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { skillPreviewSamples, skills } from '@/mocks';
import { SkillPreview } from './SkillPreview';

const codeBuild = skills.find((s) => s.name === 'code-build');

describe('SkillPreview', () => {
  it('renders Markdown headings two levels under the page title', () => {
    render(<SkillPreview value={'# Build\n\n## Steps'} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Build' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Steps' })).toBeInTheDocument();
  });

  it('caps deeper Markdown headings at h6', () => {
    render(<SkillPreview value={'### Three\n\n#### Four\n\n##### Five\n\n###### Six'} />);
    expect(screen.getByRole('heading', { level: 5, name: 'Three' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 6, name: 'Four' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 6, name: 'Five' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 6, name: 'Six' })).toBeInTheDocument();
  });

  it('draws a GFM table as a table', () => {
    render(<SkillPreview value={skillPreviewSamples.table} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Area' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'What to try' })).toBeInTheDocument();
  });

  it('shows front-matter fields as text above the body', () => {
    render(<SkillPreview value={codeBuild?.body ?? ''} />);
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('code-build')).toBeInTheDocument();
    expect(screen.getByText('description')).toBeInTheDocument();
    expect(screen.getByText('Implement a user-story issue end to end and open a PR for review.')).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'name: code-build' })).not.toBeInTheDocument();
  });

  it('keeps unfinished Markdown literal', () => {
    const { container } = render(<SkillPreview value="Use **care" />);
    expect(screen.getByText('Use **care')).toBeInTheDocument();
    expect(container.querySelector('strong')).toBeNull();
  });

  it('drops raw HTML from skill text', () => {
    const { container } = render(
      <SkillPreview
        value={
          '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<a href="javascript:alert(1)">x</a>\n\nok'
        }
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('drops unsafe link targets and opens safe links in a new tab', () => {
    const { container } = render(<SkillPreview value={'[bad](javascript:alert(1)) and [docs](https://example.com)'} />);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    const docs = screen.getByRole('link', { name: 'docs' });
    expect(docs).toHaveAttribute('target', '_blank');
    expect(docs).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows an image as its alt text, or its URL, and loads nothing', () => {
    const { container, rerender } = render(<SkillPreview value="![Architecture](https://example.com/a.png)" />);
    expect(screen.getByText('Architecture')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    rerender(<SkillPreview value="![](https://example.com/b.png)" />);
    expect(screen.getByText('https://example.com/b.png')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders other code fences as plain mono blocks', () => {
    const { container } = render(<SkillPreview value={'```bash\nnpm test\n```'} />);
    expect(container.querySelector('pre code')?.textContent).toContain('npm test');
  });

  it('shows the empty message for empty or whitespace-only text', () => {
    const msg = 'Nothing to preview yet. Write the skill in Edit.';
    const { rerender } = render(<SkillPreview value="" />);
    expect(screen.getByText(msg)).toBeInTheDocument();
    rerender(<SkillPreview value={'  \n'} />);
    expect(screen.getByText(msg)).toBeInTheDocument();
    rerender(<SkillPreview value={skillPreviewSamples.frontMatterOnly} />);
    expect(screen.getByText('qa-e2e')).toBeInTheDocument();
    expect(screen.getByText(msg)).toBeInTheDocument();
  });
});
