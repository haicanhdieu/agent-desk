import type { ITheme } from '@xterm/xterm';

// The live terminal's xterm theme, read from the design tokens (ds/tokens.css) at runtime: xterm draws with concrete
// colours, so the CSS custom properties are resolved on the terminal's element. No colour is defined here; the
// mapping follows the static Terminal's tones (TermTone): text, dim, bold, red, green, yellow, cyan, magenta, accent.

type ThemeKey = Exclude<keyof ITheme, 'extendedAnsi'>;

const TOKENS: Record<ThemeKey, string> = {
  background: '--term',
  foreground: '--term-text',
  cursor: '--text',
  cursorAccent: '--term',
  selectionBackground: '--line2',
  selectionForeground: '--term-bold',
  selectionInactiveBackground: '--line',
  scrollbarSliderBackground: '--line',
  scrollbarSliderHoverBackground: '--line2',
  scrollbarSliderActiveBackground: '--line2',
  overviewRulerBorder: '--term-bar-line',
  black: '--term-bar',
  red: '--term-red',
  green: '--term-green',
  yellow: '--term-yellow',
  blue: '--term-accent',
  magenta: '--term-magenta',
  cyan: '--term-cyan',
  white: '--term-text',
  brightBlack: '--term-dim',
  brightRed: '--fail',
  brightGreen: '--ok',
  brightYellow: '--idle',
  brightBlue: '--accent',
  brightMagenta: '--term-magenta',
  brightCyan: '--run',
  brightWhite: '--term-bold',
};

/** The token's value on `el`, or undefined when the tokens are not loaded (xterm then keeps its default). */
function token(styles: CSSStyleDeclaration, name: string): string | undefined {
  const value = styles.getPropertyValue(name).trim();
  return value === '' ? undefined : value;
}

/** xterm's theme from the tokens in effect on `el`. */
export function terminalTheme(el: Element): ITheme {
  const styles = getComputedStyle(el);
  const theme: ITheme = {};
  for (const [key, name] of Object.entries(TOKENS)) {
    const value = token(styles, name);
    if (value !== undefined) Object.assign(theme, { [key]: value });
  }
  return theme;
}

/** The monospace font stack and the terminal's font size (px) from the tokens. */
export function terminalFont(el: Element): { fontFamily?: string; fontSize?: number } {
  const styles = getComputedStyle(el);
  const size = Number.parseFloat(token(styles, '--fs-13') ?? '');
  const fontFamily = token(styles, '--mono');
  return {
    ...(fontFamily !== undefined && { fontFamily }),
    ...(Number.isFinite(size) && { fontSize: size }),
  };
}
