import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '../../assets/icons';

interface IconButtonProps {
  icon: IconName;
  onClick?: () => void;
  showDot?: boolean;
  badge?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  children?: ReactNode;
  disabled?: boolean;
}

/** Circular icon button matching the mockup's `.icon-btn` (back arrows, bell, dots menu, filters, etc). */
export function IconButton({ icon, onClick, showDot, badge, style, ariaLabel, children, disabled }: IconButtonProps) {
  return (
    <button type="button" className="icon-btn" onClick={onClick} style={style} aria-label={ariaLabel ?? icon} disabled={disabled}>
      <Icon name={icon} />
      {showDot && <span className="badge-dot" />}
      {badge && <span className="notification-count-badge">{badge}</span>}
      {children}
    </button>
  );
}
