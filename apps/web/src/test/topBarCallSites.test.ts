import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Only the shell renders chrome. The top bar, the sub navigation and the app shell are drawn by the shell host and by
// the story frame that mimics it; a screen, a layout or a route that draws its own bar is a second chrome.
const CHROME_SITES = ['app/shell/ShellHost.tsx', 'screens/shellFrame.tsx'];

const src = resolve(__dirname, '..');
const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => /\.tsx?$/.test(f) && !/\.(stories|test)\.tsx?$/.test(f));

function filesMatching(pattern: RegExp): string[] {
  return files.filter((f) => pattern.test(readFileSync(resolve(src, f), 'utf8'))).sort();
}

describe('only the shell renders chrome', () => {
  it('renders TopBar, SubNav and AppShell only in the shell host and the story frame', () => {
    expect(filesMatching(/<(TopBar|SubNav|AppShell)(?=[\s>/])/)).toEqual([...CHROME_SITES].sort());
  });

  it('sets the document title only in the shell host', () => {
    const callers = filesMatching(/\buseDocumentTitle\(/).filter((f) => f !== 'components/useDocumentTitle.ts');
    expect(callers).toEqual(['app/shell/ShellHost.tsx']);
  });
});
