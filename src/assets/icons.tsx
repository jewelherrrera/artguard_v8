/**
 * Icon sprite ported verbatim from artguard-hub-ui-mockups.html so every
 * glyph in the app matches the mockup pixel-for-pixel.
 *
 * <IconSprite /> is mounted once near the root (see App.tsx) and renders a
 * hidden <svg><symbol>…</symbol></svg> sheet. <Icon name="shield" /> then
 * references a symbol via <use>, exactly like the original mockup did.
 *
 * NOTE: "eye-off" is the one glyph that does not exist in the source mockup
 * (the mockup's password field was a static readonly example and never
 * demonstrated a "hidden" vs "visible" state). It is drawn in the same
 * stroke style/weight/viewBox as the rest of the set so the password
 * visibility toggle looks native to the system.
 */
import type { CSSProperties } from 'react';

export function IconSprite() {
  return (
    <svg style={{ display: 'none' }} aria-hidden="true">
      <symbol id="i-home" viewBox="0 0 24 24">
        <path d="M3 10.5L12 3l9 7.5" />
        <path d="M5 9.5V20a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9.5" />
      </symbol>
      <symbol id="i-compass" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9.5" />
        <polygon points="15.5 8.5 13.2 13.2 8.5 15.5 10.8 10.8 15.5 8.5" />
      </symbol>
      <symbol id="i-shield" viewBox="0 0 24 24">
        <path d="M12 21.5s7.5-3.6 7.5-9.6V6L12 3 4.5 6v5.9c0 6 7.5 9.6 7.5 9.6z" />
      </symbol>
      <symbol id="i-chat" viewBox="0 0 24 24">
        <path d="M21 11.5a8 8 0 01-8.5 8 8.4 8.4 0 01-3.6-.85L3 21l1.4-4.7A8 8 0 1121 11.5z" />
      </symbol>
      <symbol id="i-user" viewBox="0 0 24 24">
        <path d="M19 21v-1.6a4.4 4.4 0 00-4.4-4.4H9.4A4.4 4.4 0 005 19.4V21" />
        <circle cx="12" cy="7.5" r="4" />
      </symbol>
      <symbol id="i-bell" viewBox="0 0 24 24">
        <path d="M18 8.5a6 6 0 00-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5z" />
        <path d="M13.7 20.5a2 2 0 01-3.4 0" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7.5" />
        <line x1="21" y1="21" x2="16.2" y2="16.2" />
      </symbol>
      <symbol id="i-sliders" viewBox="0 0 24 24">
        <line x1="5" y1="21" x2="5" y2="13" />
        <line x1="5" y1="9" x2="5" y2="3" />
        <line x1="12" y1="21" x2="12" y2="11" />
        <line x1="12" y1="7" x2="12" y2="3" />
        <line x1="19" y1="21" x2="19" y2="15" />
        <line x1="19" y1="11" x2="19" y2="3" />
        <circle cx="5" cy="11" r="2" />
        <circle cx="12" cy="9" r="2" />
        <circle cx="19" cy="13" r="2" />
      </symbol>
      <symbol id="i-star" viewBox="0 0 24 24">
        <polygon
          points="12 2.5 15.1 8.9 22 9.9 17 14.9 18.2 21.8 12 18.5 5.8 21.8 7 14.9 2 9.9 8.9 8.9 12 2.5"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id="i-chevron-r" viewBox="0 0 24 24">
        <polyline points="9 18 15 12 9 6" />
      </symbol>
      <symbol id="i-chevron-l" viewBox="0 0 24 24">
        <polyline points="15 18 9 12 15 6" />
      </symbol>
      <symbol id="i-plus" viewBox="0 0 24 24">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </symbol>
      <symbol id="i-upload" viewBox="0 0 24 24">
        <path d="M20 16.5v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3" />
        <polyline points="7.5 8.5 12 4 16.5 8.5" />
        <line x1="12" y1="4" x2="12" y2="15.5" />
      </symbol>
      <symbol id="i-image" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <circle cx="8.5" cy="8.5" r="1.6" />
        <polyline points="21 15.5 15.5 10 5 21" />
      </symbol>
      <symbol id="i-send" viewBox="0 0 24 24">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" strokeLinejoin="round" />
      </symbol>
      <symbol id="i-paperclip" viewBox="0 0 24 24">
        <path d="M20.4 11.05l-8.6 8.6a5 5 0 01-7.1-7.07l8.6-8.6a3.3 3.3 0 014.7 4.66l-8.4 8.4a1.6 1.6 0 01-2.26-2.26l7.8-7.8" />
      </symbol>
      <symbol id="i-lock" viewBox="0 0 24 24">
        <rect x="4" y="10.5" width="16" height="10" rx="2" />
        <path d="M7.5 10.5V7.5a4.5 4.5 0 019 0v3" />
      </symbol>
      <symbol id="i-check-circle" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9.5" />
        <polyline points="8 12.5 10.8 15.3 16 9.5" />
      </symbol>
      <symbol id="i-clock" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9.5" />
        <polyline points="12 7 12 12.5 16 15" />
      </symbol>
      <symbol id="i-trending" viewBox="0 0 24 24">
        <polyline points="3 17 9.5 10.5 13.5 14.5 21 6" />
        <polyline points="15 6 21 6 21 12" />
      </symbol>
      <symbol id="i-bar" viewBox="0 0 24 24">
        <line x1="5" y1="21" x2="5" y2="14" />
        <line x1="12" y1="21" x2="12" y2="9" />
        <line x1="19" y1="21" x2="19" y2="4" />
      </symbol>
      <symbol id="i-mail" viewBox="0 0 24 24">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <polyline points="3.5 6 12 13 20.5 6" />
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24">
        <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="2.8" />
      </symbol>
      {/* Not present in the source mockup — added to match its stroke style
          so the password visibility toggle has a "hidden" state. */}
      <symbol id="i-eye-off" viewBox="0 0 24 24">
        <path d="M3.5 3.5l17 17" />
        <path d="M10.6 5.3A10.4 10.4 0 0112 5.2c6.2 0 10 6.8 10 6.8a15.6 15.6 0 01-3.4 4.2M6.9 6.9C4 8.7 2 12 2 12s3.8 6.8 10 6.8a9.9 9.9 0 004.9-1.3" />
        <path d="M9.9 9.9a2.8 2.8 0 003.9 3.9" />
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </symbol>
      <symbol id="i-zap" viewBox="0 0 24 24">
        <polygon points="13 2 4 14 11.5 14 10.5 22 20 10 12.5 10 13 2" strokeLinejoin="round" />
      </symbol>
      <symbol id="i-crown" viewBox="0 0 24 24">
        <path d="M3 18.5h18l-1.6-8.2-4.9 3.7L12 8l-2.5 6-4.9-3.7L3 18.5z" strokeLinejoin="round" />
        <line x1="4.5" y1="21" x2="19.5" y2="21" />
      </symbol>
      <symbol id="i-alert" viewBox="0 0 24 24">
        <path d="M10.6 3.9L2.4 18.3a1.8 1.8 0 001.6 2.7h16a1.8 1.8 0 001.6-2.7L13.4 3.9a1.8 1.8 0 00-2.8 0z" />
        <line x1="12" y1="9.5" x2="12" y2="13.5" />
        <circle cx="12" cy="16.8" r="0.4" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-calendar" viewBox="0 0 24 24">
        <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
        <line x1="16" y1="3" x2="16" y2="7" />
        <line x1="8" y1="3" x2="8" y2="7" />
        <line x1="3.5" y1="10" x2="20.5" y2="10" />
      </symbol>
      <symbol id="i-grid" viewBox="0 0 24 24">
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
      </symbol>
      <symbol id="i-arrow-l" viewBox="0 0 24 24">
        <line x1="20" y1="12" x2="4" y2="12" />
        <polyline points="10 18 4 12 10 6" />
      </symbol>
      <symbol id="i-dots" viewBox="0 0 24 24">
        <circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-heart" viewBox="0 0 24 24">
        <path d="M12 20.3s-7.3-4.4-9.6-9C.9 7.8 2.4 4.3 6 4.3c2 0 3.5 1.1 4.4 2.5.9-1.4 2.4-2.5 4.4-2.5 3.6 0 5.1 3.5 3.6 7-2.3 4.6-9.6 9-9.6 9z" />
      </symbol>
      <symbol id="i-fingerprint" viewBox="0 0 24 24">
        <path d="M12 2.5c-2 0-3.9.7-5.4 2" />
        <path d="M4 8c0 1.5 0 5.5-1 8" />
        <path d="M8 5.5A8 8 0 004 12c0 3-.3 5-1 7" />
        <path d="M12 2.5A9.5 9.5 0 0121.5 12c0 1.7-.1 3.2-.5 4.5" />
        <path d="M12 6a6 6 0 016 6c0 3.5-1 6-1 6" />
        <path d="M12 9.5a2.5 2.5 0 012.5 2.5c0 3-1.5 6-3 7.5" />
        <path d="M9.5 10A2.5 2.5 0 0012 12.5c0 2.5-.7 4.8-2 6.5" />
      </symbol>
      <symbol id="i-camera" viewBox="0 0 24 24">
        <path d="M4 8.5a2 2 0 012-2h1.3l1-2h7.4l1 2H18a2 2 0 012 2V18a2 2 0 01-2 2H6a2 2 0 01-2-2V8.5z" />
        <circle cx="12" cy="13" r="3.4" />
      </symbol>
      <symbol id="i-smile" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M7.8 14.3s1.7 2.2 4.2 2.2 4.2-2.2 4.2-2.2" />
        <circle cx="8.7" cy="9.3" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="15.3" cy="9.3" r="0.6" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-mic" viewBox="0 0 24 24">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0014 0" />
        <line x1="12" y1="18" x2="12" y2="21.5" />
        <line x1="8.5" y1="21.5" x2="15.5" y2="21.5" />
      </symbol>
      <symbol id="i-file" viewBox="0 0 24 24">
        <path d="M6 3.5h7l5 5V19a1.5 1.5 0 01-1.5 1.5h-10.5A1.5 1.5 0 015 19V5A1.5 1.5 0 016 3.5z" />
        <polyline points="13 3.5 13 8.5 18 8.5" />
      </symbol>
    </svg>
  );
}

export type IconName =
  | 'home'
  | 'compass'
  | 'shield'
  | 'chat'
  | 'user'
  | 'bell'
  | 'search'
  | 'sliders'
  | 'star'
  | 'chevron-r'
  | 'chevron-l'
  | 'plus'
  | 'upload'
  | 'image'
  | 'send'
  | 'paperclip'
  | 'lock'
  | 'check-circle'
  | 'clock'
  | 'trending'
  | 'bar'
  | 'mail'
  | 'eye'
  | 'eye-off'
  | 'x'
  | 'zap'
  | 'crown'
  | 'alert'
  | 'calendar'
  | 'grid'
  | 'arrow-l'
  | 'dots'
  | 'fingerprint'
  | 'heart'
  | 'camera'
  | 'smile'
  | 'mic'
  | 'file';

interface IconProps {
  name: IconName;
  className?: string;
  style?: CSSProperties;
}

/** Usage: <Icon name="shield" className="icon" style={{ stroke: 'var(--ag-accent)' }} /> */
export function Icon({ name, className = 'icon', style }: IconProps) {
  return (
    <svg className={className} style={style} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
