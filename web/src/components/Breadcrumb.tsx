import { Fragment, type ReactNode } from 'react';
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
            {i > 0 && <span className={styles.sepch} aria-hidden="true">/</span>}
            {last || !item.href ? (
              <b aria-current={last ? 'page' : undefined}>{item.label}</b>
            ) : (
              <a href={item.href}>{item.label}</a>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
