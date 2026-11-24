import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeMermaid } from '@/test/fakeMermaid';
import { skillPreviewSamples, skills } from '@/mocks';
import { SkillPreview } from './SkillPreview';

const createPlugin = vi.hoisted(() => vi.fn());
vi.mock('@streamdown/mermaid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@streamdown/mermaid')>();
  createPlugin.mockImplementation(actual.createMermaidPlugin);
  return { ...actual, createMermaidPlugin: createPlugin };
});

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

describe('SkillPreview diagrams', () => {
  it('creates the diagram plugin with securityLevel strict and nothing that loosens it', async () => {
    createPlugin.mockClear();
    render(<SkillPreview value={skillPreviewSamples.diagram} />);
    await screen.findByRole('img', { name: 'diagram' });
    expect(createPlugin).toHaveBeenCalledTimes(1);
    expect(createPlugin).toHaveBeenCalledWith({
      config: expect.objectContaining({ securityLevel: 'strict', theme: 'dark' }),
    });
    const config = (createPlugin.mock.calls[0]?.[0] as { config: Record<string, unknown> }).config;
    for (const key of ['htmlLabels', 'secure', 'startOnLoad']) expect(config).not.toHaveProperty(key);
  });

  it('forbids img elements in diagram labels, so a label cannot make the browser fetch an image', async () => {
    createPlugin.mockClear();
    render(<SkillPreview value={skillPreviewSamples.diagram} />);
    await screen.findByRole('img', { name: 'diagram' });
    const config = (createPlugin.mock.calls[0]?.[0] as { config: { dompurifyConfig?: Record<string, unknown> } })
      .config;
    expect(config.dompurifyConfig).toEqual(
      expect.objectContaining({ FORBID_TAGS: expect.arrayContaining(['img', 'style']) }),
    );
  });

  it('forbids src and srcset attributes in diagram labels, so no element can make the browser fetch a resource', async () => {
    createPlugin.mockClear();
    render(<SkillPreview value={skillPreviewSamples.diagram} />);
    await screen.findByRole('img', { name: 'diagram' });
    const config = (createPlugin.mock.calls[0]?.[0] as { config: { dompurifyConfig?: Record<string, unknown> } })
      .config;
    expect(config.dompurifyConfig).toEqual(
      expect.objectContaining({ FORBID_ATTR: expect.arrayContaining(['src', 'srcset']) }),
    );
  });

  it('does not load the diagram plugin when the text has no mermaid fence', () => {
    const loadMermaid = vi.fn(() => new Promise<never>(() => undefined));
    render(<SkillPreview value={skillPreviewSamples.table} loadMermaid={loadMermaid} />);
    expect(loadMermaid).not.toHaveBeenCalled();
  });

  it('draws a mermaid fence as a diagram', async () => {
    render(<SkillPreview value={skillPreviewSamples.diagram} />);
    expect(await screen.findByRole('img', { name: 'diagram' })).toBeInTheDocument();
  });

  it('shows "Loading diagram…" while the plugin loads', () => {
    render(<SkillPreview value={skillPreviewSamples.diagram} loadMermaid={() => new Promise(() => undefined)} />);
    expect(screen.getByText('Loading diagram…')).toBeInTheDocument();
    expect(screen.queryByText(/flowchart/)).not.toBeInTheDocument();
  });

  it('shows "Loading diagram…" while a diagram renders', async () => {
    FakeMermaid.hang = true;
    render(<SkillPreview value={skillPreviewSamples.diagram} />);
    // Wait until the plugin is loaded and the diagram is being drawn: the placeholder is then Streamdown's.
    await vi.waitFor(() => expect(FakeMermaid.rendered).toHaveLength(1));
    expect(await screen.findByText('Loading diagram…')).toBeInTheDocument();
  });

  it('a diagram that cannot be drawn shows the notice, the error and the source; the rest renders', async () => {
    render(<SkillPreview value={skillPreviewSamples.rich} />);
    expect(await screen.findAllByText('This diagram could not be drawn')).toHaveLength(1);
    expect(screen.getByText('No diagram type detected')).toBeInTheDocument();
    expect(screen.getByText('this is not a diagram').closest('pre')).not.toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'diagram' })).toBeInTheDocument();
  });

  it('Try again redraws a failed diagram', async () => {
    render(<SkillPreview value={skillPreviewSamples.brokenDiagram} />);
    await screen.findByText('This diagram could not be drawn');
    const before = FakeMermaid.rendered.length;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(FakeMermaid.rendered.length).toBeGreaterThan(before));
  });

  it('keeps a drawn diagram mounted when the preview re-renders', async () => {
    const { rerender } = render(<SkillPreview value={skillPreviewSamples.diagram} />);
    const drawn = await screen.findByRole('img', { name: 'diagram' });
    rerender(<SkillPreview value={skillPreviewSamples.diagram} />);
    expect(screen.getByRole('img', { name: 'diagram' })).toBe(drawn);
  });

  it('a diagram plugin that fails to load shows the notice, and Try again loads it again', async () => {
    const loadMermaid = vi
      .fn<() => Promise<typeof import('@streamdown/mermaid')>>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockImplementation(() => import('@streamdown/mermaid'));
    render(<SkillPreview value={skillPreviewSamples.diagram} loadMermaid={loadMermaid} />);
    expect(await screen.findByText('This diagram could not be drawn')).toBeInTheDocument();
    expect(screen.queryByText('Loading diagram…')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: 'diagram' })).toBeInTheDocument();
    expect(loadMermaid).toHaveBeenCalledTimes(2);
  });

  it('shows the source of a mermaid fence the detector did not see, never an endless loading status', () => {
    const loadMermaid = vi.fn(() => new Promise<never>(() => undefined));
    render(<SkillPreview value={'> ```mermaid\n> flowchart LR\n> A-->B\n> ```'} loadMermaid={loadMermaid} />);
    expect(screen.queryByText('Loading diagram…')).not.toBeInTheDocument();
    expect(screen.getByText(/flowchart LR/)).toBeInTheDocument();
  });

  it('clears the load error when a new fence starts a new load', async () => {
    const loadMermaid = vi
      .fn<() => Promise<typeof import('@streamdown/mermaid')>>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockReturnValue(new Promise<never>(() => undefined));
    const { rerender } = render(<SkillPreview value={skillPreviewSamples.diagram} loadMermaid={loadMermaid} />);
    await screen.findByText('This diagram could not be drawn');
    rerender(<SkillPreview value="plain text" loadMermaid={loadMermaid} />);
    rerender(<SkillPreview value={skillPreviewSamples.diagram} loadMermaid={loadMermaid} />);
    await vi.waitFor(() => expect(loadMermaid).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('This diagram could not be drawn')).not.toBeInTheDocument();
    expect(screen.getByText('Loading diagram…')).toBeInTheDocument();
  });
});
