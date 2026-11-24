import { useEffect } from 'react';

/** Sets `document.title` while mounted and restores the title from before mount on unmount. `undefined` leaves it alone. */
export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    if (title === undefined) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
