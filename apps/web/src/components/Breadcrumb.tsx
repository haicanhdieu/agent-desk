import { Fragment, type ReactNode } from 'react';
import { AppLink } from '@/ds';
import styles from './Chrome.module.css';

export interface BreadcrumbProps {
  items: { label: ReactNode; href?: string }[];
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
            {last || !item.href ? (
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
