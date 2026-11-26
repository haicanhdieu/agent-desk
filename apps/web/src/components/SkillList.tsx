import type { ReactNode } from 'react';
import { AppLink, Button } from '@/ds';
import styles from './Composites.module.css';

export interface SkillListProps {
  skills: { name: string; description: string; ruleSummary: string; href?: string }[];
  activeName?: string;
  branch: string;
  /** The repo folders searched for skills, in order. Absent while they are not known: no folder is named. */
  folders?: string[];
  onNew?(): void;
  /** Called on a plain click of a skill; the link's own navigation is then skipped. */
  onSelect?(name: string): void;
  /** Drawn under the list (the paging control). */
  footer?: ReactNode;
}

export function SkillList({ skills, activeName, branch, folders, onNew, onSelect, footer }: SkillListProps) {
  return (
    <div className={styles.skills}>
      <nav className={styles.skillsNav} aria-label="Skills">
        <div className={styles.skillsHead}>
          <h2>Skills</h2>
          <Button size="sm" icon="plus" onClick={onNew}>
            New skill
          </Button>
        </div>
        <p className={styles.skillsPath}>
          {folders ? folders.map((f) => `${f}/`).join(', ') : 'Skill folders'} on {branch}
        </p>
        <ul className={styles.skillItems}>
          {skills.map((s) => {
            const active = s.name === activeName;
            return (
              <li key={s.name}>
                <AppLink
                  href={s.href ?? `#${s.name}`}
                  className={[styles.skill, active && styles.active].filter(Boolean).join(' ')}
                  aria-current={active ? 'page' : undefined}
                  onClick={
                    onSelect &&
                    ((e) => {
                      // Modified clicks (new tab, new window) keep the link's default.
                      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      onSelect(s.name);
                    })
                  }
                >
                  <span className={styles.skillTop}>
                    <b className={styles.skillName}>{s.name}</b>
                    <span className={styles.skillRules}>{s.ruleSummary}</span>
                  </span>
                  <span className={styles.skillDesc}>{s.description}</span>
                </AppLink>
              </li>
            );
          })}
        </ul>
      </nav>
      {footer}
    </div>
  );
}
