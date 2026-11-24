import type { MouseEvent } from 'react';
import styles from './SkipLink.module.css';

/** First focusable item of every page: jumps keyboard users past the chrome to the page's `main`. */
export function SkipLink() {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const main = document.querySelector('main');
    if (!main) return;
    if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
    main.focus();
  }
  return (
    <a className={styles.skip} href="#main" onClick={onClick}>
      Skip to main content
    </a>
  );
}
