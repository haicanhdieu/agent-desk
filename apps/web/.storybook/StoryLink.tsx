import type { LinkComponent } from '../src/ds';

/**
 * Storybook's link: renders the href for inspection but keeps in-app clicks inside the story (Storybook does not
 * run the router, and following `/o/...` would replace the preview iframe).
 */
export const StoryLink: LinkComponent = ({ onClick, ...props }) => (
  <a
    {...props}
    onClick={(e) => {
      onClick?.(e);
      e.preventDefault();
    }}
  />
);
