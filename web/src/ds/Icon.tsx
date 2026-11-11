import { iconPaths, type IconName } from './icons';

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  'aria-label'?: string;
}

export function Icon({ name, size = 14, strokeWidth = 1.75, 'aria-label': ariaLabel }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true })}
    >
      {iconPaths[name]}
    </svg>
  );
}
