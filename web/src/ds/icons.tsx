import type { ReactNode } from 'react';

export type IconName =
  | 'brand' | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'runs' | 'desk' | 'external'
  | 'bell' | 'skill-file' | 'rule' | 'bot' | 'branch' | 'refresh' | 'key' | 'plus' | 'more'
  | 'warning' | 'lock' | 'x' | 'trash' | 'commit' | 'github' | 'issue' | 'pull-request' | 'panel'
  | 'fullscreen' | 'terminal' | 'transcript' | 'search' | 'copy' | 'check' | 'pause' | 'clock'
  | 'play' | 'ignored' | 'eye' | 'info';

/** Stroke glyph contents, 24 viewBox. Path data copied from the prototype boards. */
export const iconPaths: Record<IconName, ReactNode> = {
  brand: (<><rect x="2.5" y="3" width="19" height="18" rx="3.5" /><path d="M2.5 9.5h19" /><rect x="6.5" y="12.5" width="5" height="5" rx="1" fill="currentColor" stroke="none" /><path d="M14 14h4M14 17h3" /></>),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  runs: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  desk: (<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" /></>),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  bell: (<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>),
  'skill-file': (<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>),
  rule: (<><circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="18" r="2.2" /><path d="M8.2 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.8" /></>),
  bot: (<><rect x="4" y="8" width="16" height="11" rx="2.5" /><path d="M12 4v4M9 13h.01M15 13h.01" /></>),
  branch: (<><circle cx="6" cy="5.5" r="2" /><circle cx="6" cy="18.5" r="2" /><circle cx="18" cy="7.5" r="2" /><path d="M6 7.5v9M18 9.5c0 4-6 3-11.5 7" /></>),
  refresh: <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />,
  key: (<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" /></>),
  plus: <path d="M12 5v14M5 12h14" />,
  more: (<><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></>),
  warning: (<><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>),
  lock: (<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  commit: (<><circle cx="12" cy="12" r="3.5" /><path d="M3 12h5.5M15.5 12H21" /></>),
  github: (<><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5 11 15l4.5-5.5" /></>),
  issue: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /></>),
  'pull-request': (<><circle cx="6" cy="5.5" r="2" /><circle cx="6" cy="18.5" r="2" /><circle cx="18" cy="18.5" r="2" /><path d="M6 7.5v9M18 16.5V10a3 3 0 0 0-3-3h-4M13 4.5 10.5 7 13 9.5" /></>),
  panel: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>),
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  terminal: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M12 15h5" /></>),
  transcript: <path d="M4 5h16v11H9l-5 4z" />,
  search: (<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>),
  copy: (<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  pause: <path d="M9 6v12M15 6v12" />,
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  play: <path d="M7 5v14l11-7z" />,
  ignored: (<><circle cx="12" cy="12" r="9" /><path d="M6 18 18 6" /></>),
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
};
