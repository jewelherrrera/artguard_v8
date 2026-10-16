import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../../assets/icons';

interface ArtTileProps {
  /** Which of the 6 mockup gradient swatches to use. */
  variant: 1 | 2 | 3 | 4 | 5 | 6;
  size?: number;
  /** Show the small lock badge in the corner (default true). */
  locked?: boolean;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}

/** The "cloaked" protected-artwork tile — ArtGuard Hub's signature visual motif. */
export function ArtTile({ variant, size, locked = true, style, className = '', children }: ArtTileProps) {
  const sizeStyle: CSSProperties = size ? { width: size, height: size } : {};
  return (
    <div className={`art-tile art-${variant} ${className}`.trim()} style={{ ...sizeStyle, ...style }}>
      {locked && (
        <div className="lock-badge">
          <Icon name="lock" />
        </div>
      )}
      {children}
    </div>
  );
}
