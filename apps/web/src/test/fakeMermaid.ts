// Test double for `mermaid` (jsdom cannot lay out SVG). src/test/setup.ts mocks the module with this for every test,
// so the real `@streamdown/mermaid` plugin and Streamdown's diagram code run on top of it. `render` draws a stub
// <svg> for the chart types below and rejects anything else the way Mermaid does for text it cannot parse.

const DRAWABLE = /^(flowchart|graph|sequenceDiagram)\b/;

export const FakeMermaid = {
  /** true: `render` never settles (a diagram that is still drawing). */
  hang: false,
  /** Every config passed to `initialize`. */
  configs: [] as unknown[],
  /** Every chart passed to `render`. */
  rendered: [] as string[],
  reset() {
    FakeMermaid.hang = false;
    FakeMermaid.configs = [];
    FakeMermaid.rendered = [];
  },
};

const fakeMermaid = {
  initialize(config: unknown) {
    FakeMermaid.configs.push(config);
  },
  async render(_id: string, source: string): Promise<{ svg: string }> {
    FakeMermaid.rendered.push(source);
    if (FakeMermaid.hang) return new Promise(() => undefined);
    const first = source.split('\n').find((l) => l.trim() !== '') ?? '';
    if (!DRAWABLE.test(first.trim())) throw new Error('No diagram type detected');
    return { svg: '<svg role="img" aria-label="diagram" xmlns="http://www.w3.org/2000/svg"></svg>' };
  },
};

export default fakeMermaid;
