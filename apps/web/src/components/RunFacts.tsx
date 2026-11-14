import type { ReactNode } from 'react';
import { Avatar, CommandChip } from '@/ds';
import type { Actor } from '@/mocks/types';
import styles from './RunFacts.module.css';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

export interface NoteProps {
  /** muted is the side panel's explanatory copy, faint its empty states. */
  tone?: 'muted' | 'faint';
  size?: 12.5 | 13;
  children: ReactNode;
}

/** Small paragraph for the run side panel and the terminal placeholders. */
export function Note({ tone = 'muted', size = 12.5, children }: NoteProps) {
  return <p className={cx(styles.note, size === 13 ? styles.note13 : styles.note12, styles[tone])}>{children}</p>;
}

export interface StatProps {
  left: ReactNode;
  right?: ReactNode;
}

/** One line with a value on each side ("Elapsed 7:40" ... "limit 30:00"). Wrap values in <b>. */
export function Stat({ left, right }: StatProps) {
  return (
    <div className={styles.stat}>
      <span>{left}</span>
      {right}
    </div>
  );
}

export interface ActorRefProps {
  actor: Actor;
  note?: string;
  noteHref?: string;
}

/** Avatar and login, plus a faint link to the triggering comment. */
export function ActorRef({ actor, note, noteHref }: ActorRefProps) {
  return (
    <>
      <span className={styles.actor}>
        <Avatar size="sm" kind={actor.bot ? 'bot' : 'user'} initials={actor.initials} />
        {actor.login}
      </span>{' '}
      {note &&
        (noteHref ? (
          <a className={styles.actorNote} href={noteHref}>
            {note}
          </a>
        ) : (
          <span className={styles.actorNote}>{note}</span>
        ))}
    </>
  );
}

/** Rule link text: the command as a chip, the rest as plain copy. */
export function RuleText({ rule, command }: { rule: string; command: string }) {
  const rest = rule.startsWith(command) ? rule.slice(command.length) : ` ${rule}`;
  return (
    <span className={styles.rule}>
      <CommandChip>{command}</CommandChip>
      {rest}
    </span>
  );
}

export function ModelTag({ agent, model }: { agent: string; model: string }) {
  return (
    <>
      {agent} <span className={styles.model}>{model}</span>
    </>
  );
}

export interface PopoverCardProps {
  title: ReactNode;
  icon?: ReactNode;
  body: ReactNode;
  actions: ReactNode;
}

/** Contents of a run popover: bold title (optional icon), muted body, right-aligned actions. */
export function PopoverCard({ title, icon, body, actions }: PopoverCardProps) {
  return (
    <>
      <div className={styles.popTitle}>
        {icon}
        {title}
      </div>
      <p className={styles.popBody}>{body}</p>
      <div className={styles.popActions}>{actions}</div>
    </>
  );
}
