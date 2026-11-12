import { Button, RadioCard } from '@/ds';
import type { SkillTemplate } from '@/mocks/types';
import styles from './Composites.module.css';

export interface SkillTemplateCardProps {
  template: SkillTemplate;
  checked: boolean;
  onChange(v: boolean): void;
  previewHref: string;
}

/** Checkbox card for one skill template with a Preview link (Setup 3). */
export function SkillTemplateCard({ template, checked, onChange, previewHref }: SkillTemplateCardProps) {
  return (
    <RadioCard
      type="checkbox"
      name={`skill-${template.name}`}
      checked={checked}
      onChange={onChange}
      title={
        <span className={styles.tplTitle}>
          <span className={styles.tplName}>{template.name}</span>
          {template.note && <span className={styles.tplNote}>{template.note}</span>}
        </span>
      }
      description={<span className={styles.tplDesc}>{template.description}</span>}
      aside={<Button variant="ghost" size="sm" href={previewHref} aria-label={`Preview ${template.name}`}>Preview</Button>}
    />
  );
}
