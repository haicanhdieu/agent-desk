import { useEffect } from 'react';

/** Sets `document.title` while mounted and restores the title from before mount on unmount. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
