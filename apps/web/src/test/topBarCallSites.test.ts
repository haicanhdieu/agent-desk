import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The drift risk: screens and routes draw their own TopBar. Every render site is listed here with its count, so a new
// bar fails the first test until a reviewer sees it added, and each one must pass its page crumbs.
export const TOP_BAR_CALL_SITES: Record<string, number> = {
  'app/boundaries.tsx': 2,
  'app/routes/o.$org.projects.index.tsx': 1,
  'app/routes/o.$org.settings.tsx': 1,
  'app/routes/platform.tsx': 1,
  'components/SetupLayout.tsx': 1,
  'screens/DeskFrame.tsx': 1,
  'screens/InvitationAccept.tsx': 1,
  'screens/MyInvitations.tsx': 1,
  'screens/NeedsYou.tsx': 1,
  'screens/Projects.tsx': 1,
  'screens/ProjectsEmpty.tsx': 2,
  'screens/RunDetail.tsx': 1,
  'screens/RunsPage.tsx': 1,
  'screens/orgSettingsFrame.tsx': 1,
  'screens/platformFrame.tsx': 1,
  'screens/shellFrame.tsx': 1,
};

const src = resolve(__dirname, '..');
const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.stories.tsx') && !f.endsWith('.test.tsx'));

/** The JSX element text of each `<TopBar` in a file: up to the first `/>` or `>` that closes the opening tag. */
function elements(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/<TopBar(?=[\s>])/g)) {
    const start = m.index;
    const rest = text.slice(start);
    // The opening tag ends at the first `>` outside braces.
    let depth = 0;
    let end = rest.length;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && rest[i - 1] !== '=') {
        end = i + 1;
        break;
      }
    }
    out.push(rest.slice(0, end));
  }
  return out;
}

describe('TopBar call sites', () => {
  it('TopBar is rendered exactly at the listed call sites', () => {
    const found: Record<string, number> = {};
    for (const f of files) {
      const n = (readFileSync(resolve(src, f), 'utf8').match(/<TopBar(?=[\s>])/g) ?? []).length;
      if (n > 0) found[f] = n;
    }
    expect(found).toEqual(TOP_BAR_CALL_SITES);
  });

  it('every call site passes crumbs and none passes a literal empty list', () => {
    for (const f of Object.keys(TOP_BAR_CALL_SITES)) {
      const list = elements(readFileSync(resolve(src, f), 'utf8'));
      expect(list.length, f).toBe(TOP_BAR_CALL_SITES[f]);
      for (const el of list) {
        expect(el, `${f} lacks crumbs`).toMatch(/\bcrumbs=\{/);
        expect(el, `${f} passes an empty crumbs list`).not.toMatch(/crumbs=\{\[\]\}/);
      }
    }
  });
});
