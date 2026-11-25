/* Desk > Agent & settings with several agents per project: the markup only (no state, no events).
   One source for two readers: the live screen (screens/deskagent.js, which passes live:true so controls carry data-act
   and data-on attributes) and the static boards design/prototype/project/DeskAgent*.dc.html (same functions, live off).
   Spec: docs/superpowers/specs/2026-11-24-multi-agent-configs-design.md ("UI and Storybook" and BR-1 to BR-60).
   Plain JS, no dependencies. Tokens and classes are the boards' own. Loaded in the browser (window.ADV) and read by
   Node for the board generator (module.exports). */
(function (root) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const V = {};

  /* ---------- small helpers ---------- */
  // data attributes (events) only in the live screen
  const L = (o, s) => (o && o.live ? ' ' + s : '');
  const svg = (w, d) => `<svg aria-hidden="true" class="" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    eye: svg(15, '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    plus: svg(15, '<path d="M12 5v14M5 12h14"/>'),
    plus14: svg(14, '<path d="M12 5v14M5 12h14"/>'),
    x: svg(16, '<path d="M6 6l12 12M18 6 6 18"/>'),
    more: svg(16, '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
    key: svg(18, '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>'),
    info13: svg(13, '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    info16: svg(16, '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    warn: svg(18, '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'),
    refresh: svg(14, '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
    refresh13: svg(13, '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>'),
    ext: svg(13, '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    check11: svg(11, '<path d="M5 12.5 10 17l9-10"/>'),
    okc: svg(18, '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5 11 15l4.5-5.5"/>'),
    prev: svg(14, '<path d="M15 6l-6 6 6 6"/>'),
    next: svg(14, '<path d="M9 6l6 6-6 6"/>'),
    trash: svg(14, '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  };
  V.IC = IC;
  const SR = (t) => `<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${esc(t)}</span>`;

  /* ---------- providers (labels, login options, address, models). The web holds none of this; it stands for the
     capability table the API serves (AGENT_KIND_CAPABILITIES). ---------- */
  const MODELS = {
    claude: ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'claude-opus-4-1-20250805'],
    codex: ['gpt-5-codex', 'gpt-5', 'gpt-5-mini'],
    antigravity: ['gemini-3-pro', 'gemini-3-flash'],
  };
  const STANDARD = {
    claude: ['opus', 'sonnet', 'haiku'],
    codex: ['gpt-5-codex', 'gpt-5'],
    antigravity: ['gemini-3-pro', 'gemini-3-flash'],
  };
  const KINDS = [
    {
      kind: 'claude', label: 'Claude Code', run: true, address: true, maxTurns: true, standard: STANDARD.claude, models: MODELS.claude,
      auths: [
        { id: 'oauth_token', label: 'Subscription token', short: 'Subscription token', field: 'Subscription token', help: 'Paste the token from your Claude subscription. It is saved write-only and never shown again.' },
        { id: 'api_key', label: 'API key', short: 'API key', field: 'API key', help: 'Billed per token. Usage cost shows on each run.' },
      ],
      addressHelp: 'Optional. Leave empty for Anthropic’s default. Runs get it as ANTHROPIC_BASE_URL. Public https addresses only. Changing it needs the credential again.',
      defaultAddress: 'Anthropic’s default', placeholder: 'https://api.anthropic.com',
    },
    {
      kind: 'codex', label: 'OpenAI Codex', run: true, address: false, maxTurns: false, standard: STANDARD.codex, models: MODELS.codex,
      auths: [
        { id: 'auth_json', label: 'Sign-in file (auth.json)', short: 'Sign-in file', field: 'auth.json contents', help: 'Paste the contents of the auth.json file Codex CLI writes when you sign in. It is saved write-only and never shown again.' },
        { id: 'api_key', label: 'API key', short: 'API key', field: 'API key', help: 'Billed per token.' },
      ],
    },
    {
      kind: 'antigravity', label: 'Google Antigravity', run: true, address: false, maxTurns: false, standard: STANDARD.antigravity, models: MODELS.antigravity,
      auths: [{ id: 'api_key', label: 'API key', short: 'API key', field: 'API key', help: 'Create the key in your Google account. It is saved write-only and never shown again.' }],
    },
  ];
  const SOON = [['gemini-cli', 'Gemini CLI'], ['copilot-cli', 'GitHub Copilot CLI'], ['cursor', 'Cursor'], ['amp', 'Amp'], ['opencode', 'OpenCode'],
    ['aider', 'Aider'], ['cline', 'Cline'], ['goose', 'Goose'], ['qwen-code', 'Qwen Code'], ['kiro', 'Kiro']].map(([kind, label]) => ({ kind, label, run: false }));
  V.KINDS = KINDS;
  V.SOON = SOON;
  const kindOf = (k) => KINDS.find((x) => x.kind === k) || SOON.find((x) => x.kind === k) || { kind: k, label: k, auths: [], standard: [], models: [] };
  const authOf = (k, id) => (kindOf(k).auths || []).find((a) => a.id === id) || (kindOf(k).auths || [])[0] || { label: '', short: '', field: '', help: '' };
  V.kindOf = kindOf; V.authOf = authOf;

  /* ---------- provider mark: a tile with the provider's one-colour mark (currentColor). Marks were fetched on 2026-11-24 from the
     official brand pages where they offer a one-colour SVG (Antigravity, OpenCode, Aider, Cline) and from the LobeHub icon set
     (MIT, https://lobehub.com/icons) for the others; the marks stay the vendors' trademarks. The human confirms source and usage
     terms before merge (spec, Provider logos). Each entry: [viewBox, path markup]. ---------- */
  const GLYPH = {
    claude: ['0 0 24 24', '<path fill-rule="evenodd" clip-rule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"/>'],
    codex: ['0 0 24 24', '<path fill-rule="evenodd" clip-rule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"/>'],
    antigravity: ['0 0 180 180', '<path d="M144.248 149.062C151.748 154.688 162.998 150.938 152.685 140.625C121.748 110.625 128.31 28.125 89.8727 28.125C51.4352 28.125 57.9977 110.625 27.0602 140.625C15.8102 151.875 27.9977 154.688 35.4977 149.062C64.5602 129.375 62.6852 94.6875 89.8727 94.6875C117.06 94.6875 115.185 129.375 144.248 149.062Z"/>'],
    'gemini-cli': ['0 0 24 24', '<path fill-rule="evenodd" d="M16.793 10.358v3.867L7.236 18.82v-2.8l7.751-3.728-7.75-3.728V5.763l9.556 4.595z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M19.608 0A4.392 4.392 0 0124 4.392v15.216A4.392 4.392 0 0119.608 24H4.392A4.392 4.392 0 010 19.608V4.392A4.392 4.392 0 014.392 0h15.216zM4.26 1.444A2.816 2.816 0 001.444 4.26v15.48a2.816 2.816 0 002.816 2.816h15.48a2.816 2.816 0 002.816-2.816V4.26a2.816 2.816 0 00-2.816-2.816H4.26z"/>'],
    'copilot-cli': ['0 0 24 24', '<path fill-rule="evenodd" d="M19.245 5.364c1.322 1.36 1.877 3.216 2.11 5.817.622 0 1.2.135 1.592.654l.73.964c.21.278.323.61.323.955v2.62c0 .339-.173.669-.453.868C20.239 19.602 16.157 21.5 12 21.5c-4.6 0-9.205-2.583-11.547-4.258-.28-.2-.452-.53-.453-.868v-2.62c0-.345.113-.679.321-.956l.73-.963c.392-.517.974-.654 1.593-.654l.029-.297c.25-2.446.81-4.213 2.082-5.52 2.461-2.54 5.71-2.851 7.146-2.864h.198c1.436.013 4.685.323 7.146 2.864zm-7.244 4.328c-.284 0-.613.016-.962.05-.123.447-.305.85-.57 1.108-1.05 1.023-2.316 1.18-2.994 1.18-.638 0-1.306-.13-1.851-.464-.516.165-1.012.403-1.044.996a65.882 65.882 0 00-.063 2.884l-.002.48c-.002.563-.005 1.126-.013 1.69.002.326.204.63.51.765 2.482 1.102 4.83 1.657 6.99 1.657 2.156 0 4.504-.555 6.985-1.657a.854.854 0 00.51-.766c.03-1.682.006-3.372-.076-5.053-.031-.596-.528-.83-1.046-.996-.546.333-1.212.464-1.85.464-.677 0-1.942-.157-2.993-1.18-.266-.258-.447-.661-.57-1.108-.32-.032-.64-.049-.96-.05zm-2.525 4.013c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zm5 0c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zM7.635 5.087c-1.05.102-1.935.438-2.385.906-.975 1.037-.765 3.668-.21 4.224.405.394 1.17.657 1.995.657h.09c.649-.013 1.785-.176 2.73-1.11.435-.41.705-1.433.675-2.47-.03-.834-.27-1.52-.63-1.813-.39-.336-1.275-.482-2.265-.394zm6.465.394c-.36.292-.6.98-.63 1.813-.03 1.037.24 2.06.675 2.47.968.957 2.136 1.104 2.776 1.11h.044c.825 0 1.59-.263 1.995-.657.555-.556.765-3.187-.21-4.224-.45-.468-1.335-.804-2.385-.906-.99-.088-1.875.058-2.265.394zM12 7.615c-.24 0-.525.015-.84.044.03.16.045.336.06.526l-.001.159a2.94 2.94 0 01-.014.25c.225-.022.425-.027.612-.028h.366c.187 0 .387.006.612.028-.015-.146-.015-.277-.015-.409.015-.19.03-.365.06-.526a9.29 9.29 0 00-.84-.044z"/>'],
    cursor: ['0 0 24 24', '<path fill-rule="evenodd" d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z"/>'],
    amp: ['0 0 24 24', '<path fill-rule="evenodd" d="M15.087 23.18L12.03 24l-2.097-7.823-5.738 5.738-2.251-2.251 5.718-5.719-7.769-2.082.82-3.057 11.294 3.08 3.08 11.295z"/><path fill-rule="evenodd" d="M19.505 18.762l-3.057.82-2.564-9.573-9.572-2.564.819-3.057 11.295 3.079 3.08 11.295z"/><path fill-rule="evenodd" d="M23.893 14.374l-3.057.82-2.565-9.572L8.7 3.057 9.52 0l11.295 3.08 3.079 11.294z"/>'],
    opencode: ['0 0 240 300', '<path opacity="0.28" d="M180 240H60V120H180V240Z"/><path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"/>'],
    aider: ['0 0 436.000000 436.000000', '<g transform="translate(0.000000,436.000000) scale(0.100000,-0.100000)"><path d="M0 2180 l0 -2180 2180 0 2180 0 0 2180 0 2180 -2180 0 -2180 0 0 -2180z m2705 1818 c20 -20 28 -121 30 -398 l2 -305 216 -5 c118 -3 218 -8 222 -12 3 -3 10 -46 15 -95 5 -48 16 -126 25 -172 17 -86 17 -81 -17 -233 -14 -67 -13 -365 2 -438 21 -100 22 -159 5 -247 -24 -122 -24 -363 1 -458 23 -88 23 -213 1 -330 -9 -49 -17 -109 -17 -132 l0 -43 203 0 c111 0 208 -4 216 -9 10 -6 18 -51 27 -148 8 -76 16 -152 20 -168 7 -39 -23 -361 -37 -387 -10 -18 -21 -19 -214 -16 -135 2 -208 7 -215 14 -22 22 -33 301 -21 501 6 102 8 189 5 194 -8 13 -417 12 -431 -2 -12 -12 -8 -146 8 -261 8 -55 8 -95 1 -140 -6 -35 -14 -99 -17 -143 -9 -123 -14 -141 -41 -154 -18 -8 -217 -11 -679 -11 l-653 0 -11 33 c-31 97 -43 336 -27 533 5 56 6 113 2 128 l-6 26 -194 0 c-211 0 -252 4 -261 28 -12 33 -17 392 -6 522 15 186 -2 174 260 180 115 3 213 8 217 12 4 4 1 52 -5 105 -7 54 -17 130 -22 168 -7 56 -5 91 11 171 10 55 22 130 26 166 4 36 10 72 15 79 7 12 128 15 665 19 l658 5 8 30 c5 18 4 72 -3 130 -12 115 -7 346 11 454 10 61 10 75 -1 82 -8 5 -300 9 -650 9 l-636 0 -27 25 c-18 16 -26 34 -26 57 0 18 -5 87 -10 153 -10 128 5 449 22 472 5 7 26 13 46 15 78 6 1281 3 1287 -4z"/><path d="M1360 1833 c0 -5 -1 -164 -3 -356 l-2 -347 625 -1 c704 -1 708 -1 722 7 5 4 7 20 4 38 -29 141 -32 491 -6 595 9 38 8 45 -7 57 -15 11 -139 13 -675 14 -362 0 -658 -3 -658 -7z"/></g>'],
    cline: ['0 0 112 112', '<path d="M56 6.39844C62.0667 6.39844 66.4004 10.8825 66.4004 16.4609C66.4003 18.0033 66.0624 20.0605 65.5117 22.3984H83.0117C88.4176 22.3984 92.7997 26.7807 92.7998 32.1865V45.8643L105.068 58.6445C105.365 58.9541 105.366 59.4434 105.068 59.7529L92.7998 72.5312V86.21C92.7998 91.6159 88.4176 95.998 83.0117 95.998H28.9883C23.5824 95.998 19.2002 91.6158 19.2002 86.21V72.5312L6.93164 59.7529C6.63461 59.4434 6.63474 58.9541 6.93164 58.6445L19.2002 45.8643V32.1865C19.2003 26.7807 23.5825 22.3985 28.9883 22.3984H46.4883C45.9376 20.0605 45.5997 18.0033 45.5996 16.4609C45.5996 10.8826 49.9334 6.39851 56 6.39844ZM40.9092 44.7988C38.0376 44.799 35.7102 47.1265 35.71 49.998V68.3984C35.71 71.2702 38.0375 73.5984 40.9092 73.5986C43.7811 73.5986 46.1094 71.2703 46.1094 68.3984V49.998C46.1092 47.1263 43.7809 44.7988 40.9092 44.7988ZM70.5098 44.7988C67.638 44.7988 65.3098 47.1263 65.3096 49.998V68.3984C65.3096 71.2703 67.6379 73.5986 70.5098 73.5986C73.3816 73.5985 75.71 71.2703 75.71 68.3984V49.998C75.7097 47.1264 73.3814 44.7989 70.5098 44.7988Z"/>'],
    goose: ['0 0 24 24', '<path fill-rule="evenodd" d="M21.595 23.61c1.167-.254 2.405-.944 2.405-.944l-2.167-1.784a12.124 12.124 0 01-2.695-3.131 12.127 12.127 0 00-3.97-4.049l-.794-.462a1.115 1.115 0 01-.488-.815.844.844 0 01.154-.575c.413-.582 2.548-3.115 2.94-3.44.503-.416 1.065-.762 1.586-1.159.074-.056.148-.112.221-.17.003-.002.007-.004.009-.007.167-.131.325-.272.45-.438.453-.524.563-.988.59-1.193-.061-.197-.244-.639-.753-1.148.319.02.705.272 1.056.569.235-.376.481-.773.727-1.171.165-.266-.08-.465-.086-.471h-.001V3.22c-.007-.007-.206-.25-.471-.086-.567.35-1.134.702-1.639 1.021 0 0-.597-.012-1.305.599a2.464 2.464 0 00-.438.45l-.007.009c-.058.072-.114.147-.17.221-.397.521-.743 1.083-1.16 1.587-.323.391-2.857 2.526-3.44 2.94a.842.842 0 01-.574.153 1.115 1.115 0 01-.815-.488l-.462-.794a12.123 12.123 0 00-4.049-3.97 12.133 12.133 0 01-3.13-2.695L1.332 0S.643 1.238.39 2.405c.352.428 1.27 1.49 2.34 2.302C1.58 4.167.73 3.75.06 3.4c-.103.765-.063 1.92.043 2.816.726.317 1.961.806 3.219 1.066-1.006.236-2.11.278-2.961.262.15.554.358 1.119.64 1.688.119.263.25.52.39.77.452.125 2.222.383 3.164.171l-2.51.897a27.776 27.776 0 002.544 2.726c2.031-1.092 2.494-1.241 4.018-2.238-2.467 2.008-3.108 2.828-3.8 3.67l-.483.678c-.25.351-.469.725-.65 1.117-.61 1.31-1.47 4.1-1.47 4.1-.154.486.202.842.674.674 0 0 2.79-.861 4.1-1.47.392-.182.766-.4 1.118-.65l.677-.483c.227-.187.453-.37.701-.586 0 0 1.705 2.02 3.458 3.349l.896-2.511c-.211.942.046 2.712.17 3.163.252.142.509.272.772.392.569.28 1.134.49 1.688.64-.016-.853.026-1.956.261-2.962.26 1.258.75 2.493 1.067 3.219.895.106 2.051.146 2.816.043a73.87 73.87 0 01-1.308-2.67c.811 1.07 1.874 1.988 2.302 2.34h-.001z"/>'],
    'qwen-code': ['0 0 24 24', '<path fill-rule="evenodd" d="M19.713 2.825h-5.907c0-.251-.066-.503-.196-.728L12.819.728A1.46 1.46 0 0 0 11.559 0h-1.58c-.52 0-1 .275-1.26.728l-2.42 4.19a1.45 1.45 0 0 0 0 1.453l.791 1.37c.26.448.74.727 1.26.727h11.36c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-.79-1.37a1.46 1.46 0 0 0-1.26-.728zM.195 9.905l2.951 5.115a1.46 1.46 0 0 0-.531.531l-.791 1.37a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h4.84c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451L5.086 7.083a1.46 1.46 0 0 0-1.26-.728h-1.58c-.52 0-1 .276-1.26.728l-.79 1.37a1.45 1.45 0 0 0 0 1.452m15.888 13.367 2.951-5.115c.217.125.469.196.728.196h1.582c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-2.42-4.191a1.46 1.46 0 0 0-1.259-.728h-1.582c-.52 0-1 .276-1.259.728l-5.678 9.838a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h1.582c.52 0 1-.275 1.26-.728z"/>'],
    kiro: ['0 0 24 24', '<path fill-rule="evenodd" d="M4.594 6.677C6.67-2.226 18.746-2.211 21.16 6.632c.353 1.297 1.725 7.582-1.673 13.747-1.545 2.797-5.841 5.49-6.99 1.883C8.6 25.477 3.315 24.1 5.789 18.609l-.318.143c-3.57 1.305-3.863-1.208-3.173-2.513.45-.84.727-1.335.937-1.897.353-.975.458-1.568.593-2.498.27-1.837.277-3.607.765-5.167zm8.37.01a.92.92 0 00-.81.428c-.217.323-.33.825-.33 1.462 0 .705.15 1.89 1.14 1.89h.008c.757 0 1.214-.705 1.214-1.89 0-.622-.127-1.125-.367-1.455a1.014 1.014 0 00-.855-.435zm4.08 0a.92.92 0 00-.81.428c-.217.323-.33.825-.33 1.462 0 .705.15 1.89 1.14 1.89h.008c.757 0 1.215-.705 1.215-1.89 0-.622-.128-1.125-.368-1.455a1.014 1.014 0 00-.855-.435z"/>'],
  };
  const SIZES = { sm: [24, 14], md: [32, 18], lg: [40, 24] };
  V.mark = function (kind, size, soon) {
    const [t, g] = SIZES[size || 'md'];
    const color = soon ? 'var(--muted)' : 'var(--text)';
    const glyph = GLYPH[kind];
    const inner = glyph
      ? `<svg aria-hidden="true" focusable="false" width="${g}" height="${g}" viewBox="${glyph[0]}" fill="currentColor">${glyph[1]}</svg>`
      : `<span aria-hidden="true" style="font-weight:600;font-size:${Math.round(g * 0.9)}px">${esc((kindOf(kind).label || '?').charAt(0).toUpperCase())}</span>`;
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${t}px;height:${t}px;flex:0 0 auto;border:1px solid var(--line2);border-radius:${size === 'sm' ? 6 : 8}px;background:var(--raised);color:${color}">${inner}</span>`;
  };

  /* ---------- connection status: one set of words for the row, the pane and Test connection ---------- */
  const G = {
    ok: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.2l2.2 2.2 4.2-4.6" fill="none" stroke="#0F1A13" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    err: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#1E0E0C" stroke-width="1.8" stroke-linecap="round"/>',
    idle: '<circle cx="8" cy="8" r="7" fill="currentColor"/><rect x="7.1" y="4" width="1.8" height="8" rx=".6" fill="#1A1405"/>',
    ring: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    warn: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.3-.8.6-.8 1.2M8 11.6h.01" fill="none" stroke="#1F130A" stroke-width="1.6" stroke-linecap="round"/>',
    off: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5 8h6" stroke="#14171C" stroke-width="1.8" stroke-linecap="round"/>',
  };
  const ST = {
    ok: { text: 'Ready', cls: 'st-succeeded', g: 'ok', msg: 'Connected' },
    no_credential: { text: 'Needs credential', cls: 'st-idle', g: 'idle', msg: 'Save a credential, then test the connection.' },
    not_tested: { text: 'Not tested', cls: 'st-queued', g: 'ring', msg: 'The saved credential has not been tested yet.' },
    rejected: { text: 'Credential rejected', cls: 'st-failed', g: 'err', msg: 'The provider refused the saved credential. Replace it, then test again.' },
    unreachable: { text: 'Can’t reach address', cls: 'st-failed', g: 'err', msg: 'Agent Desk could not reach the API address. Check it, then test again.' },
    invalid: { text: 'Can’t verify', cls: 'st-timed_out', g: 'warn', msg: 'The provider answered in a way Agent Desk could not read. The credential is saved.' },
    unsupported: { text: 'Not checkable', cls: 'st-cancelled', g: 'off', msg: 'This provider has no check Agent Desk can run. The credential is saved.' },
    testing: { text: 'Testing…', cls: 'st-queued', g: 'ring', msg: 'Testing the connection…' },
  };
  V.ST = ST;
  // the row status of an agent: no credential beats everything; a credential with no stored result is "Not tested"
  V.statusOf = (a) => (!a.cred ? 'no_credential' : a.test ? (ST[a.test.status] ? a.test.status : 'invalid') : 'not_tested');
  V.status = function (id, extra) {
    const s = ST[id] || ST.invalid;
    return `<span class="st ${s.cls}" title="status: ${esc(id)}"${id === 'testing' ? ' aria-busy="true"' : ''}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">${G[s.g]}</svg>${esc(s.text)}${extra ? ' ' + extra : ''}</span>`;
  };

  /* ---------- fixtures: the same agents in every board and in the live screen ---------- */
  const cred = (at, by) => ({ at, by });
  V.seed = () => [
    { id: 'a-personal', name: 'Claude - Personal', kind: 'claude', label: 'Personal', auth: 'oauth_token', model: 'claude-opus-4-5-20251101', baseUrl: '', maxTurns: '', isDefault: true, cred: cred('12 Oct 2026', 'kim-hale'), test: { status: 'ok', at: '11:02' } },
    { id: 'a-work', name: 'Claude - Work', kind: 'claude', label: 'Work', auth: 'api_key', model: 'claude-sonnet-4-5-20250929', baseUrl: 'https://gateway.harbor-labs.com/anthropic', maxTurns: '40', isDefault: false, cred: cred('3 Nov 2026', 'jordan-wu'), test: { status: 'ok', at: '10:48' } },
    { id: 'a-codex', name: 'Codex - Reviews', kind: 'codex', label: 'Team', auth: 'auth_json', model: 'gpt-5-codex', baseUrl: '', maxTurns: '', isDefault: false, cred: cred('18 Nov 2026', 'kim-hale'), test: null },
    { id: 'a-anti', name: 'Antigravity', kind: 'antigravity', label: '', auth: 'api_key', model: 'gemini-3-pro', baseUrl: '', maxTurns: '', isDefault: false, cred: cred('20 Nov 2026', 'kim-hale'), test: { status: 'unsupported', at: '09:15' } },
    { id: 'a-staging', name: 'Claude - Staging', kind: 'claude', label: 'Staging', auth: 'api_key', model: 'claude-sonnet-4-5-20250929', baseUrl: '', maxTurns: '', isDefault: false, cred: null, test: null },
    { id: 'a-legacy', name: 'Claude - Legacy key', kind: 'claude', label: 'Old key', auth: 'api_key', model: 'claude-haiku-4-5-20251001', baseUrl: '', maxTurns: '', isDefault: false, cred: cred('12 Sep 2026', 'jordan-wu'), test: { status: 'rejected', at: '11:29' } },
  ];
  // 24 agents for the paged list (page 2 shows 21 to 24): extra rows cover the other statuses
  V.seedMany = () => {
    const base = V.seed();
    const names = ['Claude - Team A', 'Claude - Team B', 'Claude - Team C', 'Claude - Team D', 'Claude - Team E', 'Claude - Team F', 'Claude - Team G', 'Claude - Team H', 'Claude - Team I', 'Claude - Team J', 'Claude - Team K', 'Claude - Team L', 'Codex - Nightly', 'Codex - Docs', 'Codex - Spikes', 'Codex - Release', 'Antigravity - Lab', 'Claude - Contractor'];
    const more = names.map((n, i) => ({ id: 'a-x' + i, name: n, kind: n.startsWith('Codex') ? 'codex' : n.startsWith('Anti') ? 'antigravity' : 'claude', label: n.split(' - ')[1] || '', auth: 'api_key', model: n.startsWith('Codex') ? 'gpt-5' : n.startsWith('Anti') ? 'gemini-3-flash' : 'claude-sonnet-4-5-20250929', baseUrl: '', maxTurns: '', isDefault: false, cred: cred('2 Nov 2026', 'kim-hale'), test: { status: 'ok', at: '08:30' } }));
    more[15].test = { status: 'unreachable', at: '08:31' };
    more[16].test = { status: 'invalid', at: '08:31' };
    more[17].test = null; more[17].cred = null;
    return base.concat(more).sort((a, b) => (a.isDefault === b.isDefault ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.isDefault ? -1 : 1));
  };
  V.pageInfo = (all, page, size) => {
    size = size || 20;
    const pages = Math.max(1, Math.ceil(all.length / size));
    const p = Math.min(Math.max(1, page || 1), pages);
    return { rows: all.slice((p - 1) * size, p * size), page: p, pages, total: all.length, from: (p - 1) * size + 1, to: Math.min(all.length, p * size) };
  };
  // rules that name an agent (the delete safeguard and the rules page)
  V.RULES = [
    { cmd: '/code-build', agentId: null },
    { cmd: '/code-review', agentId: 'a-work' },
    { cmd: '/code-e2e', agentId: 'a-staging' },
    { cmd: '/triage', agentId: 'a-personal' },
    { cmd: '/docs-update', agentId: null },
    { cmd: '/qa-e2e', agentId: 'a-codex' },
  ];
  V.LEGACY_RUN = { agentId: 'a-legacy', text: 'Run 58 is paused and can be resumed.' };

  /* ---------- field pieces ---------- */
  function inp(o) {
    const desc = [o.help && o.id + 'h', o.error && o.id + 'e'].filter(Boolean).join(' ');
    const type = o.password ? ' type="password" autocomplete="off" spellcheck="false"' : '';
    return `<input id="${o.id}"${type} class="input${o.mono ? ' mono' : ''}${o.num ? ' num' : ''}${o.error ? ' bad' : ''}" value="${esc(o.value || '')}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}${o.error ? ' aria-invalid="true"' : ''}${desc ? ` aria-describedby="${desc}"` : ''}${o.disabled ? ' disabled' : ''}${o.style ? ` style="${o.style}"` : ''}${o.live ? ` data-on="${o.on || 'ag'}" data-f="${o.f}"` : ''}${o.aria ? ` aria-label="${esc(o.aria)}"` : ''}>`;
  }
  function fld(o, control) {
    const lab = o.label ? `<label for="${o.id}">${esc(o.label)}${o.optional ? ' <span class="faint" style="font-weight:400">optional</span>' : ''}</label>` : '';
    const help = o.help ? `<span id="${o.id}h" class="help">${o.helpHtml ? o.help : esc(o.help)}</span>` : '';
    const err = o.error ? `<span id="${o.id}e" class="ferr" role="alert">${esc(o.error)}</span>` : '';
    return `<div class="field">${lab}${control}${help}${err}</div>`;
  }
  function banner(tone, ico, title, detail, reqId, extra, role) {
    return `<div class="banner ${tone}" role="${role || (tone === 'err' ? 'alert' : 'note')}" style="align-items:center"><span class="b-ico">${ico}</span><div class="grow" style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:600">${esc(title)}</b>${detail ? `<span style="font-size:12.5px" class="muted">${esc(detail)}</span>` : ''}${reqId ? `<span style="font-size:12px" class="muted">Request ID: <code class="mono" style="color:var(--text);font-size:12px">${esc(reqId)}</code></span>` : ''}</div>${extra || ''}</div>`;
  }
  V.banner = banner;
  const note = (t) => `<div class="banner off" role="note" style="align-items:center;padding:10px 14px"><span class="b-ico">${IC.info16}</span><span class="muted" style="font-size:13px">${esc(t)}</span></div>`;
  const retryBtn = (o) => `<button class="btn"${L(o, 'data-act="ag-retry"')}>${IC.refresh}Retry</button>`;

  /* ---------- tab strip ---------- */
  const TABS = [['agents', 'Agents'], ['github', 'GitHub connection'], ['limits', 'Limits'], ['danger', 'Danger zone']];
  V.tabs = function (on, o) {
    const list = TABS.filter(([id]) => id !== 'danger' || o.canDanger !== false);
    return list.map(([id, label]) => {
      const href = o.href ? o.href(id) : '#';
      const live = o.live ? ` data-tab="${id}"` : '';
      return `<a href="${esc(href)}" class="${on === id ? 'on' : ''}" role="tab" id="agent-settings-tab-${id}" aria-selected="${on === id}" aria-controls="agent-settings-panel-${id}"${on === id ? '' : ' tabindex="-1"'}${live}>${label}</a>`;
    }).join('');
  };
  V.main = function (o) {
    return `<main style="flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden">
<div style="padding:24px 40px 0"><h1>Agent &amp; settings</h1></div>
<div class="tabs" role="tablist" aria-label="Agent and project settings" style="height:40px;flex:0 0 40px;padding:0 32px;margin-top:14px;border-bottom:1px solid var(--line)">${V.tabs(o.tab, o)}</div>
<div id="agent-settings-panel-${o.tab}" role="tabpanel" aria-labelledby="agent-settings-tab-${o.tab}" style="flex:1;min-height:0;display:flex;overflow:hidden">${o.body}</div>
</main>`;
  };
  const section = (title, desc, body, chip) => `<section style="display:grid;grid-template-columns:260px minmax(0,1fr);gap:32px;padding:22px 0;border-bottom:1px solid var(--line)">
<div style="display:flex;flex-direction:column;gap:4px"><h2 style="font-size:15px" class="row" >${esc(title)}${chip ? `<span class="lbl" style="margin-left:8px">${esc(chip)}</span>` : ''}</h2><p class="muted" style="font-size:13px">${esc(desc)}</p></div>
<div style="display:flex;flex-direction:column;gap:14px;max-width:620px">${body}</div></section>`;
  // A tab panel: the content scrolls inside it; the optional footer stays at the bottom.
  const panelPad = (html, foot) => `<div style="flex:1;min-width:0;min-height:0;display:flex;flex-direction:column">
<div data-sc="panel" tabindex="0" role="region" aria-label="${esc(((/<h2[^>]*>([^<]+)/.exec(html) || [])[1] || 'Settings').trim())}" style="flex:1 1 0;min-height:0;overflow-y:auto;padding:0 40px 24px">${html}</div>${foot ? `
<div style="flex:0 0 auto;border-top:1px solid var(--line);background:var(--bg);padding:12px 40px;display:flex;justify-content:flex-end;gap:8px">${foot}</div>` : ''}
</div>`;

  /* ---------- Agents tab ---------- */
  function rowMenu(a, o, up) {
    const dflt = a.isDefault;
    const only = (o.page ? o.page.total : o.rows.length) === 1;
    const item = (act, label, color, disabled) => `<button class="btn ghost" role="menuitem" style="justify-content:flex-start;width:100%;color:${color || 'var(--text)'}"${disabled ? ' disabled aria-disabled="true"' : ''}${L(o, `data-act="${act}" data-id="${esc(a.id)}"`)}>${label}</button>`;
    return `<div class="pop" role="menu" aria-label="Actions for ${esc(a.name)}" style="right:14px;${up ? 'bottom:calc(100% - 10px)' : 'top:calc(100% - 10px)'};width:${only ? 330 : 270}px;padding:6px;gap:2px;text-align:left">${item('ag-test', 'Test connection')}${dflt ? '' : item('ag-setdefault', 'Set as default')}${item('ag-delete', only ? 'Delete (a project needs at least one agent)' : dflt ? 'Delete (set another default first)' : 'Delete', dflt ? 'var(--faint)' : 'var(--fail)', dflt)}</div>`;
  }
  function agentRow(a, i, o) {
    const k = kindOf(a.kind);
    const sub = [k.label, a.label, authOf(a.kind, a.auth).short].filter(Boolean).join(' · ');
    const testing = o.testingId === a.id;
    const sel = o.selectedId === a.id;
    const open = o.menuId === a.id;
    const busy = o.busyId === a.id || testing;
    const edit = `<button class="btn sm" aria-label="${o.can.write ? 'Edit' : 'View'} ${esc(a.name)}"${L(o, `data-act="ag-edit" data-id="${esc(a.id)}"`)}${sel ? ' aria-expanded="true"' : ''}>${o.can.write ? 'Edit' : 'View'}</button>`;
    const menu = o.can.write ? `<button class="btn ghost iconbtn" aria-label="Actions for ${esc(a.name)}" aria-haspopup="menu" aria-expanded="${open}"${busy ? ' disabled' : ''}${L(o, `data-act="rowmenu" data-id="${esc(a.id)}"`)}>${IC.more}</button>` : '';
    return `<li style="list-style:none;position:relative;${i ? 'border-top:1px solid var(--line);' : ''}display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px 8px 12px 14px;${sel ? 'background:var(--raised);box-shadow:inset 3px 0 0 var(--accent);' : ''}">
${V.mark(a.kind, 'md')}
<div style="min-width:0;display:flex;flex-direction:column;gap:2px"><span class="row" style="gap:8px;min-width:0"><b style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0" title="${esc(a.name)}">${esc(a.name)}</b>${a.isDefault ? '<span class="lbl" style="flex:0 0 auto">Default</span>' : ''}</span><span class="muted" style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(sub)}">${esc(sub)}</span><span class="mono faint" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.model)}</span></div>
<div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end"><span role="status" style="display:inline-flex">${V.status(testing ? 'testing' : V.statusOf(a))}</span>${edit}${menu}</div>${open ? rowMenu(a, o, o.rows.length > 3 && i >= o.rows.length - 2) : ''}</li>`;
  }
  const skelRow = (i) => `<li style="list-style:none;${i ? 'border-top:1px solid var(--line);' : ''}display:grid;grid-template-columns:32px minmax(0,1fr) 120px;gap:14px;align-items:center;padding:12px 14px"><span aria-hidden="true" style="display:block;width:32px;height:32px;border-radius:8px;background:var(--raised)"></span><span aria-hidden="true" style="display:flex;flex-direction:column;gap:7px"><span class="skel" style="width:${[46, 38, 52][i % 3]}%"></span><span class="skel" style="width:${[64, 58, 70][i % 3]}%"></span></span><span aria-hidden="true" class="skel" style="width:100%"></span></li>`;
  V.pager = function (info, o) {
    const { page, pages, from, to, total } = info;
    const btn = (p) => `<button class="btn ${p === page ? '' : 'ghost'} iconbtn num" ${p === page ? 'aria-current="page"' : ''} aria-label="Page ${p}"${L(o, `data-act="ag-page" data-page="${p}"`)}>${p}</button>`;
    const nums = []; let last = 0;
    [...new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b).forEach((p) => { if (last && p - last > 1) nums.push('<span class="faint pg-gap">…</span>'); nums.push(btn(p)); last = p; });
    return `<div class="pager"><nav aria-label="Pagination, agents" class="pg"><span class="pg-range"><span class="pg-word">Showing </span><span class="num" style="color:var(--text)">${from}–${to}</span> of <span class="num" style="color:var(--text)">${total}</span></span><span class="pg-pages"><button class="btn ghost pg-step"${page <= 1 ? ' disabled' : ''}${L(o, `data-act="ag-page" data-page="${page - 1}"`)}>${IC.prev}<span class="pg-step-t">Previous</span></button><span class="pg-slots w">${nums.join('')}</span><span class="pg-slots n">${nums.join('')}</span><button class="btn ghost pg-step"${page >= pages ? ' disabled' : ''}${L(o, `data-act="ag-page" data-page="${page + 1}"`)}><span class="pg-step-t">Next</span>${IC.next}</button></span></nav></div>`;
  };
  V.agentsList = function (o) {
    const add = o.can.write ? `<button class="btn primary"${L(o, 'data-act="ag-add"')}${o.pane && o.pane.mode === 'add' ? ' aria-expanded="true"' : ''}>${IC.plus}Add agent</button>` : '';
    const head = `<div class="row" style="justify-content:space-between;align-items:flex-start;gap:16px"><div style="display:flex;flex-direction:column;gap:4px"><h2 style="font-size:16px">Agents</h2><p class="muted" style="font-size:13px">Configure the agent runtimes and accounts available to this project.</p><p class="muted" style="font-size:13px">The default agent runs a command when its routing rule does not pick an agent.</p></div>${add}</div>`;
    let body; let foot = '';
    if (o.state === 'loading') {
      body = `<div role="status" aria-busy="true">${SR('Loading agents')}<ul aria-hidden="true" style="margin:0;padding:0;border:1px solid var(--line);border-radius:10px;overflow:hidden">${skelRow(0)}${skelRow(1)}${skelRow(2)}</ul></div>`;
    } else if (o.state === 'error') {
      body = banner('err', IC.warn, 'Could not load the agents. Try again.', '', o.reqId || 'req_01JDE7Q3M9KT', retryBtn(o));
    } else if (o.state === 'empty' || !o.rows.length) {
      body = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:40px 16px;border:1px solid var(--line);border-radius:10px"><h3>No agents yet</h3><p class="muted" style="font-size:13px;max-width:48ch">Add an agent so a routing rule has something to run. The first one you add becomes the project default.</p>${o.can.write ? `<div style="margin-top:6px"><button class="btn primary"${L(o, 'data-act="ag-add"')}>${IC.plus}Add agent</button></div>` : ''}</div>`;
    } else {
      body = `<ul aria-label="Agents" style="margin:0;padding:0;border:1px solid var(--line);border-radius:10px;overflow:visible">${o.rows.map((a, i) => agentRow(a, i, o)).join('')}</ul>`;
      if (o.page && o.page.pages > 1) foot = V.pager(o.page, o);
    }
    const px = o.pane || o.dialogOnly ? 28 : 40;
    return `<div style="flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden">
<div style="flex:0 0 auto;padding:22px ${px}px 16px">${head}</div>
<div data-sc="list" tabindex="0" role="region" aria-label="Agents list" style="flex:1 1 0;min-height:0;overflow-y:auto;padding:0 ${px}px 24px">${body}</div>${foot ? `
<div style="flex:0 0 auto;border-top:1px solid var(--line);background:var(--bg);padding:10px ${px}px">${foot}</div>` : ''}
</div>`;
  };
  V.agents = function (o) {
    return V.agentsList(o) + (o.pane ? V.pane(o.pane, o) : '');
  };

  /* ---------- the add / edit / view pane ---------- */
  const modelOptions = (k, cur, withDefault) => {
    const kd = kindOf(k);
    return kd.models.map((m) => `<option${m === cur ? ' selected' : ''}>${esc(m)}</option>`).join('');
  };
  function modelField(f, kd, o) {
    // state: ready (the provider's list), loading, fallback (standard names), error; typed ("Other model...")
    const ms = f.modelState || (f.agent && f.agent.cred ? 'ready' : 'standard');
    const typed = f.model === '_other' || f.typedModel != null;
    const names = ms === 'ready' ? kd.models : kd.standard;
    const cur = typed ? '_other' : f.model;
    const opts = ms === 'loading' ? `<option selected>${esc(f.model || '')}</option>` : names.map((m) => `<option${m === cur ? ' selected' : ''}>${esc(m)}</option>`).join('') + `<option${typed ? ' selected' : ''}>Other model…</option>`;
    const host = f.baseUrl ? f.baseUrl.replace(/^https?:\/\//, '').split('/')[0] : '';
    let help;
    if (ms === 'loading') help = 'Loading models…';
    else if (ms === 'standard') help = 'Showing the standard names. Save a credential to load the provider’s list.';
    else if (ms === 'fallback') help = `Showing the standard names. The model list${host ? ' at ' + host : ''} could not be loaded.`;
    else if (ms === 'error') help = 'The model list could not be loaded. You can still type a model name.';
    else help = 'Loaded from the provider. Rules that don’t name a model use this one.';
    const sel = `<select id="ag-model" class="input mono"${f.step || f.readOnly || ms === 'loading' ? ' disabled' : ''}${L(o, `data-on="${o.on || 'ag'}" data-f="model"`)}${ms === 'loading' ? ' aria-busy="true"' : ''}>${opts}</select>`;
    let extra = '';
    if (typed) {
      extra = `<input id="ag-model-typed" class="input mono${f.errors && f.errors.model ? ' bad' : ''}" aria-label="Model name" value="${esc(f.typedModel || '')}"${f.errors && f.errors.model ? ' aria-invalid="true" aria-describedby="ag-model-typede"' : ''}${f.step || f.readOnly ? ' disabled' : ''}${L(o, `data-on="${o.on || 'ag'}" data-f="typedModel"`)}>${f.errors && f.errors.model ? `<span id="ag-model-typede" class="ferr" role="alert">${esc(f.errors.model)}</span>` : ''}`;
      help = ms === 'standard' || ms === 'fallback' || ms === 'error' ? help + ' ' : '';
    }
    const helpTyped = typed ? `<span class="help">Sent to ${esc(kd.label)} exactly as typed. Rules that don’t name a model use this one.</span>` : '';
    return `<div class="field"><label for="ag-model">Default model</label>${sel}${extra}<span class="help"${ms === 'fallback' || ms === 'error' ? ' style="color:var(--faint)"' : ''}>${esc(help.trim())}</span>${helpTyped}</div>`;
  }
  const checkbox = (id, on, label, help, disabled, o, act) => `<div class="field"><label class="row" style="gap:10px;font-size:13.5px;${disabled ? 'opacity:.7;' : ''}"><span class="cbx${on ? ' on' : ''}" id="${id}" role="checkbox" aria-checked="${on}"${disabled ? ' aria-disabled="true"' : ' tabindex="0"'}${disabled ? '' : L(o, `data-act="${act}"`)}>${on ? IC.check11 : ''}</span><span>${esc(label)}</span></label>${help ? `<span class="help">${esc(help)}</span>` : ''}</div>`;
  const seg = (label, items, on, o, act, disabled) => `<div class="seg" role="group" aria-label="${esc(label)}">${items.map((it) => `<button type="button" class="${it.id === on ? 'on' : ''}" aria-pressed="${it.id === on}"${disabled ? ' disabled' : ''}${L(o, `data-act="${act}" data-id="${esc(it.id)}"`)}>${esc(it.label)}</button>`).join('')}</div>`;

  function providerPicker(f, o) {
    const dis = f.step || f.agentId;
    const cards = KINDS.map((k) => {
      const on = f.kind === k.kind;
      return `<div class="radio-card${on ? ' on' : ''}" role="radio" aria-checked="${on}" tabindex="${on || (!f.kind && k.kind === 'claude') ? 0 : -1}" style="position:relative;flex-direction:column;align-items:flex-start;gap:10px;padding:12px"${dis ? ' aria-disabled="true"' : ''}${dis ? '' : L(o, `data-act="ag-provider" data-id="${k.kind}"`)}><span class="rdot" style="position:absolute;top:12px;right:12px;margin:0"></span>${V.mark(k.kind, 'lg')}<b style="font-weight:500">${esc(k.label)}</b></div>`;
    }).join('');
    const soon = SOON.map((k) => `<span role="listitem" aria-label="${esc(k.label)}, coming soon" style="display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px 0 4px;border:1px dashed var(--line2);border-radius:999px;color:var(--muted);font-size:13px;white-space:nowrap">${V.mark(k.kind, 'sm', true)}<span aria-hidden="true">${esc(k.label)}</span></span>`).join('');
    return `<div class="field" role="radiogroup" aria-labelledby="ag-prov-l"><span id="ag-prov-l" class="flabel">Provider</span><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${cards}</div></div>
<div class="field"><span class="flabel">Coming soon</span><div role="list" style="display:flex;flex-wrap:wrap;gap:8px">${soon}</div></div>`;
  }
  function readOnlyProvider(a) {
    const k = kindOf(a.kind);
    return `<div class="field"><span class="flabel">Provider</span><div class="row" style="gap:10px;height:42px;padding:0 10px;border:1px solid var(--line2);border-radius:8px;background:var(--panel);color:var(--muted)">${V.mark(a.kind, 'sm')}<span style="color:var(--text)">${esc(k.label)}</span><span class="grow"></span><span class="faint" style="font-size:12.5px">Fixed after creation</span></div></div>`;
  }
  function nameFields(f, o) {
    const dis = f.step || f.readOnly;
    return fld({ id: 'ag-name', label: 'Name', help: 'How this agent shows in rules and runs, for example Claude - Personal.', error: f.errors && f.errors.name }, inp({ id: 'ag-name', value: f.name, error: f.errors && f.errors.name, help: true, disabled: dis, live: o.live, f: 'name' }))
      + fld({ id: 'ag-label', label: 'Account label', optional: true, help: 'Optional. Who or what this account is, for example Personal or Work.', error: f.errors && f.errors.label }, inp({ id: 'ag-label', value: f.label, error: f.errors && f.errors.label, help: true, disabled: dis, live: o.live, f: 'label' }));
  }
  const credFieldControl = (f, o, auth) => `<div class="row" style="gap:6px">${inp({ id: 'ag-token', password: true, mono: true, value: f.token, help: true, error: f.errors && f.errors.token, disabled: f.step, live: o.live, f: 'token', placeholder: f.placeholder || 'Paste the value' })}</div>`;

  function addressField(f, kd, o, changed) {
    if (!kd.address) return '';
    const help = changed ? `Changed from ${f.origBaseUrl ? f.origBaseUrl : kd.defaultAddress}. It is saved together with the new credential below.` : kd.addressHelp.replace('ANTHROPIC_BASE_URL', 'ANTHROPIC_BASE_URL');
    const helpHtml = !changed ? esc(help).replace('ANTHROPIC_BASE_URL', '<span class="mono">ANTHROPIC_BASE_URL</span>') : esc(help);
    return fld({ id: 'ag-addr', label: 'API address', help: helpHtml, helpHtml: true, error: f.errors && f.errors.baseUrl }, inp({ id: 'ag-addr', mono: true, value: f.baseUrl, placeholder: kd.placeholder, help: true, error: f.errors && f.errors.baseUrl, disabled: f.step || f.readOnly, live: o.live, f: 'baseUrl' }));
  }

  // The credential block of the edit pane: saved row, "Replace" panel, "Credential needed again"
  function credentialBlock(f, kd, o, changed) {
    const a = f.agent;
    const authId = f.auth || a.auth;
    const au = authOf(a.kind, authId);
    const stId = f.testing ? 'testing' : V.statusOf(a);
    const saved = a.cred
      ? `<b style="font-weight:500">${esc(authOf(a.kind, a.auth).label)}</b><span class="faint" style="font-size:12.5px">Set ${esc(a.cred.at)} by ${esc(a.cred.by)}. Hidden for good after saving.</span>`
      : `<b style="font-weight:500">No credential saved</b><span class="faint" style="font-size:12.5px">Runs on this agent fail until you save one.</span>`;
    const head = `<div class="row" style="gap:12px;padding:12px 14px;border:1px solid var(--line2);border-radius:8px;background:var(--panel)"><span class="faint" style="display:inline-flex">${IC.key}</span><div class="grow" style="display:flex;flex-direction:column;gap:2px">${saved}</div>${changed ? '<span class="muted" style="font-size:13px;white-space:nowrap">Replaced when you save</span>' : `<span role="status" style="display:inline-flex;font-size:13px">${V.status(stId)}</span>`}${f.readOnly || !o.can.secret ? '' : `<button class="btn sm"${a.cred ? '' : ' hidden'} aria-expanded="${!!(f.replacing || changed)}"${f.step ? ' disabled' : ''}${L(o, 'data-act="ag-replace"')}>Replace</button>`}</div>`;
    const open = f.replacing || changed || !a.cred;
    if (!open || f.readOnly || !o.can.secret) return `<div class="field"><span class="flabel">Credential</span>${head}</div>`;
    const title = changed ? 'Credential needed again' : a.cred ? 'Replace credential' : 'Add credential';
    const noteLine = changed ? `<p class="help row" style="gap:6px;align-items:flex-start"><span style="margin-top:2px;display:inline-flex">${IC.info13}</span><span>The API address changed. A saved credential is only sent to the address it was saved with, so paste it again for the new one.</span></p>` : '';
    const help = changed
      ? 'We test the new token with one small call before saving. The address and the token are saved together; runs already in progress keep the ones they started with.'
      : 'We save it, then test it with one small call. If the test fails it stays saved and the agent shows the result.';
    const types = kd.auths.length > 1 ? seg('Credential type', kd.auths, authId, o, 'ag-auth', f.step) : '';
    const busy = f.step === 'credential' || f.step === 'test';
    return `<div class="field"><span class="flabel">Credential</span>${head}
<div role="group" aria-label="${esc(title)}" style="display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid #7C8FD8;border-radius:8px;background:#1E2333">
<b style="font-weight:600">${esc(title)}</b>${noteLine}${types}
${fld({ id: 'ag-token', label: 'New ' + au.field.toLowerCase().replace(/^api/, 'API').replace(/^auth\.json/, 'auth.json'), help: au.help, error: f.errors && f.errors.token }, credFieldControl(Object.assign({}, f, { placeholder: changed ? 'Paste the token' : '' }), o, au))}
<p class="help">${esc(help)}</p>
<div class="row" style="gap:8px;justify-content:flex-end"><button class="btn ghost"${f.step ? ' disabled' : ''}${L(o, 'data-act="ag-replace-cancel"')}>Cancel</button><button class="btn primary"${!f.token || f.step ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}${L(o, 'data-act="ag-cred-save"')}>${busy ? (f.step === 'test' ? 'Testing connection…' : 'Saving credential…') : 'Save and test'}</button></div></div></div>`;
  }
  function testBlock(f, o) {
    const a = f.agent;
    const r = f.result; // {status}
    let line;
    if (f.testing) line = `<span class="row" style="gap:8px">${V.status('testing')}</span>`;
    else if (r) line = `<div style="display:flex;flex-direction:column;gap:2px"><span>${V.status(r.status)}</span><span class="muted" style="font-size:12.5px">${esc(ST[r.status].msg)}</span></div>`;
    else line = `<span class="muted" style="font-size:13px">${a.test ? 'Last test ' + esc(a.test.at) + '.' : 'Not tested yet.'}</span>`;
    return `<div class="field"><span class="flabel">Connection</span><div class="row" style="gap:12px;padding:12px 14px;border:1px solid var(--line2);border-radius:8px;background:var(--panel);align-items:center"><div class="grow" role="status" aria-live="polite">${line}</div><button class="btn sm"${f.testing || f.step || f.readOnly || !a.cred ? ' disabled' : ''}${f.testing ? ' aria-busy="true"' : ''}${L(o, 'data-act="ag-test-pane"')}>Test connection</button></div></div>`;
  }


  /* ---------- New-project wizard, step 2 "Add agent": pick the agent you work with, set up that one ---------- */
  const AUTH_BLURB = { oauth_token: 'Uses your Claude subscription.', auth_json: 'The file Codex CLI writes when you sign in.', api_key: 'Billed per token.' };
  const pasteWord = (au) => (au.id === 'auth_json' ? 'the file contents' : au.id === 'api_key' ? 'the key' : 'the token');
  V.setupAgent = function (f, o) {
    const kd = f.kind ? kindOf(f.kind) : null;
    const E = f.errors || {};
    const busy = !!f.step;
    const on = o.on || 'w2';
    const oo = Object.assign({}, o, { on });
    const stepText = { agent: 'Saving agent…', credential: 'Saving credential…', test: 'Testing connection…' }[f.step];
    // provider cards (same ones as the Add agent pane), legend "Agent"
    const dis = busy || f.returning;
    const cards = KINDS.map((k) => {
      const sel = f.kind === k.kind;
      return `<div class="radio-card${sel ? ' on' : ''}" role="radio" aria-checked="${sel}" tabindex="${dis ? -1 : sel || (!f.kind && k.kind === 'claude') ? 0 : -1}" style="position:relative;flex-direction:column;align-items:flex-start;gap:10px;padding:12px"${dis ? ' aria-disabled="true"' : ''}${dis ? '' : L(o, `data-act="w2-provider" data-id="${k.kind}"`)}><span class="rdot" style="position:absolute;top:12px;right:12px;margin:0"></span>${V.mark(k.kind, 'lg')}<b style="font-weight:500">${esc(k.label)}</b></div>`;
    }).join('');
    const soon = SOON.map((k) => `<span role="listitem" aria-label="${esc(k.label)}, coming soon" style="display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px 0 4px;border:1px dashed var(--line2);border-radius:999px;color:var(--muted);font-size:13px;white-space:nowrap">${V.mark(k.kind, 'sm', true)}<span aria-hidden="true">${esc(k.label)}</span></span>`).join('');
    const picker = `<div class="field" role="radiogroup" aria-labelledby="w-prov-l"${E.kind ? ' aria-describedby="w-prov-e"' : ''}><span id="w-prov-l" class="flabel">Agent</span><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${cards}</div>${E.kind ? '<span id="w-prov-e" class="ferr" role="alert">Pick an agent to continue.</span>' : ''}${f.returning ? '<span class="help">This agent is set up. To add another one, use Agent &amp; settings.</span>' : ''}</div>
<div class="field"><span class="flabel">Coming soon</span><div role="list" style="display:flex;flex-wrap:wrap;gap:8px">${soon}</div></div>`;
    let fields = '';
    if (kd && kd.run) {
      const au = authOf(f.kind, f.auth);
      const credType = kd.auths.length > 1
        ? `<div class="field" role="radiogroup" aria-labelledby="w-auth-l"><span id="w-auth-l" class="flabel">Credential type</span><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">${kd.auths.map((a) => { const sel = a.id === (f.auth || kd.auths[0].id); return `<div class="radio-card${sel ? ' on' : ''}" role="radio" aria-checked="${sel}" tabindex="${sel ? 0 : -1}"${dis ? ' aria-disabled="true"' : ''}${dis ? '' : L(o, `data-act="w2-auth" data-id="${a.id}"`)}><span class="rdot"></span><div><b style="font-weight:500">${esc(a.label)}</b><div class="faint" style="font-size:12.5px">${esc(AUTH_BLURB[a.id] || '')}</div></div></div>`; }).join('')}</div></div>`
        : `<div class="field"><span class="flabel">Credential type</span><span style="font-size:13.5px">${esc(kd.auths[0].label)}</span></div>`;
      const eye = `<button type="button" class="btn" aria-label="Show ${esc(au.field.toLowerCase())} while typing"${f.showSecret ? ' aria-pressed="true"' : ''}${busy ? ' disabled' : ''}${L(o, 'data-act="w2-show"')}>${IC.eye}</button>`;
      const secret = f.returning
        ? `<div class="field"><span class="flabel">${esc(au.field)}</span><div class="row" style="gap:12px;padding:12px 14px;border:1px solid var(--line2);border-radius:8px;background:var(--panel)"><span class="faint" style="display:inline-flex">${IC.key}</span><div class="grow" style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:500">Credential saved</b><span class="faint" style="font-size:12.5px">Hidden for good after saving. Replace it on Agent &amp; settings.</span></div></div></div>`
        : fld({ id: 'w-token', label: au.field, help: au.help, error: E.token }, `<div class="row">${inp({ id: 'w-token', password: true, mono: true, value: f.token, help: true, error: E.token, disabled: busy, live: o.live, on, f: 'token' }).replace('type="password"', f.showSecret && o.live ? 'type="text"' : 'type="password"')}${eye}</div>`);
      const result = f.result && (f.result.status === 'rejected' || f.result.status === 'unreachable')
        ? banner('err', IC.warn, ST[f.result.status].text, ST[f.result.status].msg, null, null, 'alert') : '';
      const addr = f.returning ? '' : addressField(Object.assign({}, f, { readOnly: false, step: f.step, errors: E }), kd, oo, false).replace(/data-on="ag"/g, `data-on="${on}"`);
      const mf = modelField(Object.assign({}, f, { readOnly: !!f.returning, errors: E, modelState: f.returning ? 'ready' : (f.modelState || 'standard') }), kd, oo);
      const conc = fld({ id: 'w-conc', label: 'Concurrent runs', help: 'Idle runs hold a slot until you finish them.', error: E.concurrent }, inp({ id: 'w-conc', num: true, value: f.concurrent, help: true, error: E.concurrent, style: 'width:90px', disabled: busy, live: o.live, on, f: 'concurrent' }));
      fields = `${credType}${secret}${result}${addr}<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start">${mf}${conc}</div>`;
    }
    const status = busy ? `<p class="help" role="status">${esc(stepText)}</p>` : '';
    const banr = f.banner ? banner('err', IC.warn, f.banner.title, f.banner.detail, f.banner.reqId, null, 'alert') : '';
    const anyway = f.result && (f.result.status === 'rejected' || f.result.status === 'unreachable');
    const back = o.live ? `<button class="btn ghost"${busy ? ' disabled' : ''} data-act="w2-back">${IC.prev}Back</button>` : `<a href="${esc(o.backHref || 'Setup1.dc.html')}" class="btn ghost">${IC.prev}Back</a>`;
    const nextBtn = (label, act, primary, href) => (o.live ? `<button class="btn${primary ? ' primary' : ''}"${busy ? ' disabled' : ''}${busy && primary ? ' aria-busy="true"' : ''} data-act="${act}">${label}</button>` : `<a href="${esc(href)}" class="btn${primary ? ' primary' : ''}">${label}</a>`);
    const foot = `${back}<span class="grow"></span>${anyway ? nextBtn('Continue anyway', 'w2-anyway', false, o.nextHref || 'Setup3.dc.html') : ''}${nextBtn(busy ? esc(stepText) : 'Continue', 'w2-continue', true, o.nextHref || 'Setup3.dc.html')}`;
    return `<main style="flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden">
<div data-sc="wizard" tabindex="0" role="region" aria-label="Add your agent" style="flex:1 1 0;min-height:0;overflow-y:auto;padding:40px 56px 24px">
<div style="max-width:720px;display:flex;flex-direction:column;gap:24px"><div style="display:flex;flex-direction:column;gap:8px"><span class="muted" style="font-size:13px">Step 2 of 4</span><h1>Add your agent</h1>
<p class="muted">Pick the agent you work with. Runs use it unless a rule picks another agent. You can add more agents later.</p></div>
${banr}${picker}${fields}</div>
</div>
<div style="flex:0 0 auto;border-top:1px solid var(--line);background:var(--bg);padding:14px 56px 12px"><div style="max-width:720px;display:flex;flex-direction:column;gap:8px"><div class="row" style="gap:10px">${foot}</div>${status}<p class="faint" style="font-size:12.5px">Not ready yet? You can leave setup and come back; the project keeps your progress.</p></div></div>
</main>`;
  };

  V.pane = function (f, o) {
    const add = f.mode === 'add';
    const view = f.mode === 'view';
    const title = add ? 'Add agent' : view ? 'View agent' : 'Edit agent';
    const kd = f.kind ? kindOf(f.kind) : null;
    let parts = [];
    if (f.mode === 'gone') {
      parts.push(banner('err', IC.warn, 'This agent no longer exists.', 'Another admin deleted it. Close this pane and reload the list.'));
    } else {
      if (view) parts.push(note('You can see this agent but not change it.'));
      if (f.banner) parts.push(banner('err', IC.warn, f.banner.title, f.banner.detail, f.banner.reqId));
      if (add) parts.push(providerPicker(f, o));
      else parts.push(readOnlyProvider(f.agent));
      if (kd && kd.run) {
        const changed = !add && kd.address && f.baseUrl !== (f.origBaseUrl || '');
        parts.push(nameFields(f, o));
        if (add) {
          const au = authOf(f.kind, f.auth);
          parts.push(`<div class="field"><span class="flabel">Authentication</span>${kd.auths.length > 1 ? seg('Authentication', kd.auths, f.auth || kd.auths[0].id, o, 'ag-auth', f.step) : `<span style="font-size:13.5px">${esc(kd.auths[0].label)}</span>`}</div>`);
          parts.push(fld({ id: 'ag-token', label: au.field, help: au.help, error: f.errors && f.errors.token }, credFieldControl(f, o, au)));
          parts.push(addressField(f, kd, o, false));
        } else {
          parts.push(addressField(f, kd, o, changed));
          parts.push(credentialBlock(f, kd, o, changed));
        }
        parts.push(modelField(f, kd, o));
        if (!add && kd.maxTurns) parts.push(fld({ id: 'ag-turns', label: 'Max turns', optional: true, help: 'Optional. The most turns one run may take on this agent. Leave empty for no limit.', error: f.errors && f.errors.maxTurns }, inp({ id: 'ag-turns', num: true, value: f.maxTurns, help: true, error: f.errors && f.errors.maxTurns, style: 'width:90px', disabled: f.step || f.readOnly, live: o.live, f: 'maxTurns' })));
        const isDef = !add && f.agent.isDefault;
        parts.push(checkbox('ag-def', isDef || !!f.makeDefault, 'Use as the project default', isDef ? 'Set another agent as default to change this.' : '', isDef || f.readOnly || f.step, o, 'ag-def-toggle'));
        if (!add) parts.push(testBlock(f, o));
      } else if (add) {
        parts.push(`<p class="muted" style="font-size:13px">Pick a provider to set up its name, login and model.</p>`);
      }
    }
    // footer
    const saving = f.step;
    const stepText = { agent: 'Saving agent…', credential: 'Saving credential…', test: 'Testing connection…' }[saving];
    let foot;
    if (f.mode === 'gone' || view) foot = `<button class="btn"${L(o, 'data-act="ag-close"')}>Close</button>`;
    else foot = `<button class="btn ghost"${saving ? ' disabled' : ''}${L(o, 'data-act="ag-close"')}>Cancel</button><button class="btn primary"${!kd || !kd.run || saving ? ' disabled' : ''}${saving ? ' aria-busy="true"' : ''}${L(o, 'data-act="ag-save"')}>${saving ? esc(stepText) : 'Save agent'}</button>`;
    const status = saving ? `<p class="help" role="status">${esc(stepText)}</p>` : '';
    const headTitle = !add && f.agent && f.mode !== 'gone' ? `<span class="row" style="gap:10px;min-width:0">${V.mark(f.agent.kind, 'sm')}<h2 style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(f.agent.name)}">${title}</h2></span>` : `<h2>${title}</h2>`;
    // header and footer stay in view; only the form between them scrolls
    return `<aside aria-label="${title}" style="width:560px;flex:0 0 560px;min-height:0;border-left:1px solid var(--line);background:var(--bg);display:flex;flex-direction:column;overflow:hidden">
<div class="row" style="flex:0 0 auto;justify-content:space-between;padding:18px 24px 14px;border-bottom:1px solid var(--line)">${headTitle}<button class="btn ghost iconbtn" aria-label="Close"${saving ? ' disabled' : ''}${L(o, 'data-act="ag-close"')}>${IC.x}</button></div>
<div data-sc="pane" tabindex="0" role="region" aria-label="${title} form" style="flex:1 1 0;min-height:0;overflow-y:auto;padding:16px 24px 20px;display:flex;flex-direction:column;gap:16px">
${parts.join('\n')}
</div>
<div style="flex:0 0 auto;border-top:1px solid var(--line);background:var(--bg);padding:12px 24px 14px;display:flex;flex-direction:column;gap:8px"><div class="row" style="gap:8px"><span class="grow"></span>${foot}</div>
${status}${view || f.mode === 'gone' ? '' : '<p class="faint" style="font-size:12.5px">Saving does not change runs that already started.</p>'}</div>
</aside>`;
  };

  /* ---------- dialogs and toasts (boards draw them in place; the live screen uses the same markup) ---------- */
  V.deleteDialog = function (d, o) {
    const busy = d.state === 'deleting';
    const blocked = d.state === 'blocked';
    const err = d.state === 'error';
    let b = `<h2 style="font-size:18px">Delete agent <span style="font-size:17px">${esc(d.name)}</span>?</h2><p class="muted" style="font-size:13.5px">Rules and runs stop using it. Run history keeps its name.</p>`;
    if (blocked) b += banner('err', IC.warn, d.title, d.detail);
    if (err) b += banner('err', IC.warn, 'Internal server error', '', d.reqId || 'req_01JDE7Q3M9KT');
    const foot = blocked
      ? `<button class="btn"${L(o, 'data-act="dialog-close"')}>Close</button>`
      : `<button class="btn ghost"${busy ? ' disabled' : ''}${L(o, 'data-act="dialog-close"')}>Keep agent</button><button class="btn solid-danger"${busy ? ' disabled aria-busy="true"' : ''}${L(o, 'data-act="ag-delete-confirm"')}>${busy ? 'Deleting…' : 'Delete agent'}</button>`;
    return `<div class="overlay${o && o.live ? ' fx' : ''}" style="z-index:40"><div class="dialog" role="dialog" aria-modal="true" aria-label="Delete agent ${esc(d.name)}?" style="width:480px"><div class="d-b">${b}</div><div class="d-f">${foot}</div></div></div>`;
  };
  V.toast = (title) => `<div class="banner ok" role="status" style="position:absolute;right:16px;bottom:16px;width:360px;box-shadow:0 14px 40px rgba(0,0,0,.55);z-index:6"><span class="b-ico">${IC.okc}</span><div class="grow" style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:600;font-size:13px">${esc(title)}</b></div><button class="btn ghost iconbtn sm" aria-label="Dismiss" style="width:26px;padding:0;flex:0 0 auto">${svg(14, '<path d="M6 6l12 12M18 6 6 18"/>')}</button></div>`;

  /* ---------- GitHub connection tab ---------- */
  const kv = (rows) => `<dl class="kv" style="grid-template-columns:150px 1fr;font-size:13px">${rows.map(([t, d]) => `<dt>${esc(t)}</dt><dd${d.cls ? ` class="${d.cls}"` : ''}${d.style ? ` style="${d.style}"` : ''}>${d.html}</dd>`).join('')}</dl>`;
  const okLine = (t) => `<span class="st st-succeeded" title="status: succeeded"><svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16">${G.ok}</svg></span>${t}`;
  V.github = function (g, o) {
    // g: {state:'ready'|'loading'|'error', mode:'webhook'|'polling', interval, checking, refused, triggerError, lastText}
    if (g.state === 'loading') {
      const bar = (w) => `<span aria-hidden="true" style="display:block;height:30px;width:${w};background:var(--raised);border-radius:6px"></span>`;
      return panelPad(section('GitHub connection', 'Where commands come from and where agents write.', `<div role="status" aria-busy="true" style="display:flex;flex-direction:column;gap:8px">${SR('Loading the connection')}<span aria-hidden="true" style="display:flex;flex-direction:column;gap:8px">${bar('100%')}${bar('100%')}${bar('60%')}</span></div>`));
    }
    if (g.state === 'error') {
      return panelPad(section('GitHub connection', 'Where commands come from and where agents write.', banner('err', IC.warn, 'Could not load the connection. Try again.', '', 'req_01JDE7Q3M9KT', retryBtn(o))));
    }
    const polling = g.mode === 'polling';
    const trig = `<div style="display:flex;flex-direction:column;gap:6px"><div class="seg" role="group" aria-label="Trigger mode"${g.triggerError ? ' aria-invalid="true" aria-describedby="trig-e"' : ''}><button type="button" class="${polling ? '' : 'on'}" aria-pressed="${!polling}"${L(o, 'data-act="gh-mode" data-id="webhook"')}>Webhook</button><button type="button" class="${polling ? 'on' : ''}" aria-pressed="${polling}"${L(o, 'data-act="gh-mode" data-id="polling"')}>Polling</button></div>${polling ? `<div class="seg" role="group" aria-label="Check every">${['5 min', '10 min', '15 min', '30 min'].map((i) => `<button type="button" class="${g.interval === i ? 'on' : ''}" aria-pressed="${g.interval === i}"${L(o, `data-act="gh-interval" data-id="${i}"`)}>${i}</button>`).join('')}</div>` : ''}<span class="faint" style="font-size:12.5px">Webhook is near-instant. Polling works without a public URL; runs start up to one interval later.</span>${g.triggerError ? `<span id="trig-e" class="ferr" role="alert">${esc(g.triggerError)}</span>` : ''}</div>`;
    const rows = [
      ['App installation', { html: okLine('harbor-labs, 1 repository'), cls: 'row', style: 'gap:6px' }],
      ['Repository', { html: 'harbor-labs/invoicer-api', cls: 'mono' }],
      ['Trigger mode', { html: trig }],
      [polling ? 'Last checked' : 'Last event', { html: polling ? (g.refused ? esc('2 hours ago (polling)') : okLine('20s ago, no new comments (polling)')) : okLine('issue_comment, 2 min ago, accepted (webhook)'), cls: 'row', style: 'gap:6px' }],
      ['Default branch', { html: 'main <span class="faint" style="font-family:var(--sans)">protected, bot can commit skills</span>', cls: 'mono' }],
    ];
    const act = polling
      ? `<button class="btn ghost sm"${g.checking ? ' disabled aria-busy="true"' : ''}${L(o, 'data-act="gh-check"')}>${IC.refresh13}${g.checking ? 'Checking…' : 'Check now'}</button>`
      : `<button class="btn ghost sm"${L(o, 'data-act="gh-ping"')}>${IC.refresh13}Send test ping</button>`;
    const body = `${kv(rows)}<div class="row" style="gap:8px"><a href="https://github.com/" class="btn sm"${o.live ? ' target="_blank" rel="noopener"' : ''}>${IC.ext}Manage installation on GitHub</a>${act}</div>${g.refused ? banner('err', IC.warn, 'Polling is paused: the connection’s token was revoked. Reconnect it, then check again.') : ''}`;
    return panelPad(section('GitHub connection', 'Where commands come from and where agents write.', body));
  };

  /* ---------- Limits tab ---------- */
  const unitSel = (id, unit, dis, o, f) => `<select id="${id}-u" class="input" style="width:104px" aria-label="Unit"${dis ? ' disabled' : ''}${L(o, `data-on="lim" data-f="${f}Unit"`)}>${['minutes', 'hours', 'days'].map((u) => `<option${u === unit ? ' selected' : ''}>${u}</option>`).join('')}</select>`;
  V.limits = function (l, o) {
    // l: {values:{timeout,timeoutUnit,...}, errors:{}, saving, readOnly, banner}
    const v = l.values; const e = l.errors || {}; const dis = l.saving || l.readOnly;
    const dur = (id, key, label, help) => fld({ id, label, help, error: e[key] }, `<div class="row">${inp({ id, num: true, value: v[key], style: 'width:90px', error: e[key], help: true, disabled: dis, live: o.live, on: 'lim', f: key, aria: label })}${unitSel(id, v[key + 'Unit'], dis, o, key)}</div>`);
    const num = (id, key, label, help, unit) => fld({ id, label, help, error: e[key] }, unit ? `<div class="row">${inp({ id, num: true, value: v[key], style: 'width:90px', error: e[key], help: true, disabled: dis, live: o.live, on: 'lim', f: key })}<span class="muted">${esc(unit)}</span></div>` : inp({ id, num: true, value: v[key], style: 'width:90px', error: e[key], help: true, disabled: dis, live: o.live, on: 'lim', f: key }));
    const fields = `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 20px">
${dur('l1', 'timeout', 'Run time limit', 'From 1 minute to 7 days. The repo token is renewed while the run lasts.')}
${dur('l2', 'pausedKeep', 'Keep a paused run for', 'After this, a paused run expires and its saved session is deleted.')}
${dur('l3', 'doneKeep', 'Keep a finished run’s session for', 'How long a finished run can be reopened. 0 turns this off.')}
${num('l4', 'idle', 'End idle runs after', 'Only counts while no terminal is open.', 'minutes unattended')}
${num('l5', 'concurrent', 'Concurrent runs', 'Idle runs count. Extra runs wait in the queue.')}
${num('l6', 'perTicket', 'Runs per ticket', 'Stops runaway chains. Further commands are ignored.')}
${num('l7', 'autoResume', 'Automatic resumes after a crash', 'How many times in a row a run resumes by itself after its pod is killed or the agent crashes. Typing in the terminal or pressing Resume starts the count again. 0 turns it off.')}
</div>`;
    const save = l.readOnly ? '' : `<button class="btn primary"${l.saving ? ' disabled aria-busy="true"' : ''}${L(o, 'data-act="lim-save"')}>${l.saving ? 'Saving…' : 'Save limits'}</button>`;
    const top = (l.readOnly ? note('You can see these but not change them.') : '') + (l.banner ? banner('err', IC.warn, l.banner.title, l.banner.detail, l.banner.reqId) : '');
    return panelPad(section('Limits', 'Applies to every agent in this project.', top + fields, 'Project-wide'), save);
  };
  V.limitsSeed = () => ({ timeout: '30', timeoutUnit: 'minutes', pausedKeep: '24', pausedKeepUnit: 'hours', doneKeep: '2', doneKeepUnit: 'hours', idle: '10', concurrent: '2', perTicket: '10', autoResume: '5' });

  /* ---------- Danger zone tab (the existing delete-project flow, unchanged) ---------- */
  V.danger = function (o) {
    return panelPad(section('Danger zone', '', `<div class="row" style="gap:12px;padding:14px;border:1px solid #5A3431;border-radius:8px"><div class="grow" style="font-size:13px"><b style="font-weight:600">Delete project</b><div class="muted">Removes rules, run history and the stored credentials. Skills stay in the repo. The GitHub App stays installed until you remove it on GitHub.</div></div><button class="btn danger"${L(o, 'data-act="dng-delete"')}>Delete project</button></div>`));
  };

  root.ADV = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
