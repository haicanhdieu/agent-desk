import { describe, expect, it } from 'vitest';
import { terminalFont } from './terminalTheme';

function elementWith(vars: Record<string, string>): HTMLElement {
  const el = document.createElement('div');
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
  document.body.append(el);
  return el;
}

describe('terminalFont', () => {
  it('uses the terminal font stack, not the UI --mono stack, so the rest of the app keeps its font', () => {
    const el = elementWith({
      '--mono': 'UiMono, monospace',
      '--term-mono': 'TermMono, "Symbols", monospace',
      '--fs-13': '13px',
    });
    expect(terminalFont(el)).toEqual({ fontFamily: 'TermMono, "Symbols", monospace', fontSize: 13 });
  });

  it('leaves the font to xterm when the tokens are not loaded', () => {
    expect(terminalFont(elementWith({}))).toEqual({});
  });
});
