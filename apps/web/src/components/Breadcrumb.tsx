import { Fragment, type ReactNode } from 'react';
import { AppLink } from '@/ds';
import styles from './Chrome.module.css';

/** A text crumb (a link when it has an href, unless it is the last), or a control such as a switch button, rendered as is. */
export type BreadcrumbItem = { label: ReactNode; href?: string } | { control: ReactNode };

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className={styles.crumbs} aria-label="Breadcrumb">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && (
              <span className={styles.sepch} aria-hidden="true">
                /
              </span>
            )}
            {'control' in item ? (
              <span className={styles.crumbControl}>{item.control}</span>
            ) : last || !item.href ? (
              <b
                className={styles.crumb}
                aria-current={last ? 'page' : undefined}
                title={typeof item.label === 'string' ? item.label : undefined}
              >
                {item.label}
              </b>
            ) : (
              <AppLink
                href={item.href}
                className={styles.crumb}
                title={typeof item.label === 'string' ? item.label : undefined}
              >
                {item.label}
              </AppLink>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
