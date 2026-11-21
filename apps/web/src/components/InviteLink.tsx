import { useEffect, useId, useRef } from 'react';
import { Button, StaticInput } from '@/ds';
import styles from './Invitations.module.css';

export interface InviteLinkProps {
  link: string;
  onCopy: () => void;
  /** The clipboard refused: select the link text so it can be copied by hand. */
  copyFailed?: boolean;
}

/** The labelled read-only invitation link plus "Copy link". */
export function InviteLink({ link, onCopy, copyFailed }: InviteLinkProps) {
  const labelId = useId();
  const textRef = useRef<HTMLSpanElement>(null);
  const selectLink = () => {
    if (!textRef.current) return;
    const range = document.createRange();
    range.selectNodeContents(textRef.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };
  useEffect(() => {
    if (copyFailed) selectLink();
  }, [copyFailed, link]);
  // The effect only runs when copyFailed flips; a repeat failure must re-select too.
  const copy = () => {
    onCopy();
    if (copyFailed) selectLink();
  };

  return (
    <div className={styles.link}>
      <span id={labelId} className={styles.linkLabel}>
        Invitation link
      </span>
      <div className={styles.linkField}>
        <StaticInput aria-labelledby={labelId}>
          <span ref={textRef} className={styles.linkText} title={link}>
            {link}
          </span>
        </StaticInput>
        <Button icon="copy" onClick={copy}>
          Copy link
        </Button>
      </div>
    </div>
  );
}
