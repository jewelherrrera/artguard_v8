import { useState } from 'react';
import type { CSSProperties } from 'react';
import './ProfileAvatar.css';

interface ProfileAvatarProps {
  className: string;
  imageUrl?: string | null;
  initials: string;
  style?: CSSProperties;
  ariaHidden?: boolean;
}

export function ProfileAvatar({ className, imageUrl, initials, style, ariaHidden = false }: ProfileAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string>();
  const image = imageUrl?.trim();
  const showImage = Boolean(image && image !== failedImageUrl);
  const { backgroundImage: _backgroundImage, ...fallbackStyle } = style ?? {};

  return (
    <div className={`${className} profile-avatar`} style={fallbackStyle} aria-hidden={ariaHidden}>
      {showImage && (
        <img
          className="profile-avatar-image"
          src={image}
          alt=""
          onError={() => setFailedImageUrl(image)}
        />
      )}
      {!showImage && <span className="profile-avatar-fallback">{initials}</span>}
    </div>
  );
}
