import { Icon, InlineStatus, type IconName } from '@/ds';
import type { AgentStatusTone } from '@/mocks/types';
import styles from './AgentRow.module.css';

const GLYPHS: Record<AgentStatusTone, IconName> = { ok: 'check', warn: 'warning', err: 'x', off: 'info' };

/** A status word with its glyph: the glyph and the text carry the meaning, never the colour alone. */
export function AgentStatusMark({ tone, text, busy }: { tone: AgentStatusTone; text: string; busy?: boolean }) {
  const known = Object.hasOwn(GLYPHS, tone) ? tone : 'off';
  return (
    <span className={styles.status} aria-busy={busy || undefined}>
      <InlineStatus tone={known} icon={<Icon name={busy ? 'refresh' : GLYPHS[known]} size={14} />}>
        {text}
      </InlineStatus>
    </span>
  );
}

export interface AgentStatusProps {
  /** The status word: `ok`, `no_credential`, `not_tested`, `rejected`, `unreachable`, `invalid`, `unsupported` or `testing`. */
  status: string;
  /** The provider's credential is optional (OpenCode): no credential is a neutral state, not a need. */
  credentialOptional?: boolean;
}

const WORDS: Record<string, { tone: AgentStatusTone; text: string }> = {
  ok: { tone: 'ok', text: 'Ready' },
  no_credential: { tone: 'warn', text: 'Needs credential' },
  not_tested: { tone: 'off', text: 'Not tested' },
  rejected: { tone: 'err', text: 'Credential rejected' },
  unreachable: { tone: 'err', text: "Can't reach address" },
  invalid: { tone: 'warn', text: "Can't verify" },
  unsupported: { tone: 'off', text: 'Not checkable' },
  testing: { tone: 'off', text: 'Testing…' },
};

/** Maps a status word to the row's tone, glyph and text. A status the web does not know reads "Can't verify". */
export function AgentStatus({ status, credentialOptional = false }: AgentStatusProps) {
  if (status === 'no_credential' && credentialOptional) return <AgentStatusMark tone="off" text="No credential" />;
  const word = Object.hasOwn(WORDS, status) ? WORDS[status] : WORDS.invalid;
  return <AgentStatusMark tone={word.tone} text={word.text} busy={status === 'testing'} />;
}
