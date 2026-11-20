import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react';
import { Banner, Button, Skeleton } from '@/ds';
import type { SkillPreviewProps } from './SkillPreview';
import styles from './SkillPreviewPane.module.css';

export type SkillPreviewModule = { default: ComponentType<SkillPreviewProps> };

export interface SkillPreviewPaneProps extends SkillPreviewProps {
  /** Loads the renderer. Stories and tests pass a pending or failing loader. Default: () => import('./SkillPreview'). */
  load?: () => Promise<SkillPreviewModule>;
}

const defaultLoad = (): Promise<SkillPreviewModule> => import('./SkillPreview');

interface BoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

class PreviewBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.pane}>
        <Banner
          tone="err"
          title="Could not show the preview"
          live="assertive"
          actions={
            <Button
              size="sm"
              onClick={() => {
                this.setState({ failed: false });
                this.props.onRetry();
              }}
            >
              Try again
            </Button>
          }
        />
      </div>
    );
  }
}

/** Lazy-loads the Markdown renderer and owns its loading and error states. */
export function SkillPreviewPane({ load = defaultLoad, ...props }: SkillPreviewPaneProps) {
  // A rejected lazy() stays rejected, so each retry builds a fresh one.
  const [Preview, setPreview] = useState(() => lazy(load));
  return (
    <PreviewBoundary onRetry={() => setPreview(() => lazy(load))}>
      <Suspense
        fallback={
          <div className={styles.pane} role="status">
            <span className={styles.visuallyHidden}>Loading the preview</span>
            <Skeleton variant="text" lines={8} />
          </div>
        }
      >
        <Preview {...props} />
      </Suspense>
    </PreviewBoundary>
  );
}
