import { Button, Dialog } from '@/ds';
import { SkillPreviewPane, type SkillPreviewPaneProps } from './SkillPreviewPane';
import styles from './SkillTemplatePreview.module.css';

export interface SkillTemplatePreviewProps {
  name: string;
  /** The template's bundled SKILL.md text; nothing is fetched. */
  body: string;
  onClose(): void;
  /** Loads the renderer; stories and tests pass a pending or failing loader. */
  load?: SkillPreviewPaneProps['load'];
}

/** Dialog that shows one skill template's SKILL.md through the sanitising preview pane. Render it only while open. */
export function SkillTemplatePreview({ name, body, onClose, load }: SkillTemplatePreviewProps) {
  return (
    <Dialog
      open
      title={`${name} SKILL.md`}
      width={720}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className={styles.body}>
        <SkillPreviewPane value={body} {...(load && { load })} />
      </div>
    </Dialog>
  );
}
