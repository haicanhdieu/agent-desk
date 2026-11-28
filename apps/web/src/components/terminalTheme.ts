import type { AgentKind } from '@agentdesk/contracts';
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

/**
 * OpenCode paints every cell with its own near-black background, which tmux hands the browser as palette colour 232
 * (#080808). Left alone it draws as a darker box inside the pane; it takes the terminal background instead. The
 * extended palette starts at colour 16, so colour 232 is entry 216. xterm has no background-only slot, so this also
 * applies when colour 232 is a foreground: text in that colour on the terminal background is invisible.
 */
const OPENCODE_BACKGROUND_ENTRY = 232 - 16;

/** xterm's theme from the tokens in effect on `el`; the colour 232 remap is only for OpenCode's terminal. */
export function terminalTheme(el: Element, agentKind?: AgentKind | null): ITheme {
  const styles = getComputedStyle(el);
  const theme: ITheme = {};
  for (const [key, name] of Object.entries(TOKENS)) {
    const value = token(styles, name);
    if (value !== undefined) Object.assign(theme, { [key]: value });
  }
  if (agentKind === 'opencode' && theme.background !== undefined) {
    // An empty entry is not a colour: xterm keeps its own palette colour there.
    theme.extendedAnsi = Array.from({ length: OPENCODE_BACKGROUND_ENTRY + 1 }, (_, i) =>
      i === OPENCODE_BACKGROUND_ENTRY ? (theme.background ?? '') : '',
    );
  }
  return theme;
}

/**
 * The terminal's font stack (--term-mono, not the UI's --mono) and font size (px) from the tokens. xterm's DOM renderer
 * draws every glyph with the font, so the stack must cover what Claude Code prints (blocks, boxes, bullets).
 */
export function terminalFont(el: Element): { fontFamily?: string; fontSize?: number } {
  const styles = getComputedStyle(el);
  const size = Number.parseFloat(token(styles, '--fs-13') ?? '');
  const fontFamily = token(styles, '--term-mono');
  return {
    ...(fontFamily !== undefined && { fontFamily }),
    ...(Number.isFinite(size) && { fontSize: size }),
  };
}
