import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { IconButton } from './IconButton';

export interface OptionsMenuItem {
  label: string;
  onClick: () => void;
  /** Renders the item in the app's danger/destructive color (matches chat's "Block user" style). */
  danger?: boolean;
}

interface OptionsMenuProps {
  items: OptionsMenuItem[];
  ariaLabel?: string;
  /** Which side of the trigger the dropdown hangs from. Defaults to 'right'. */
  align?: 'left' | 'right';
  /** Style overrides for the trigger button (e.g. the semi-transparent dark
   * variant used on photo/cover headers). */
  triggerStyle?: CSSProperties;
}

/**
 * Reusable "more options" (⋮) trigger + dropdown, styled to match the
 * existing card/menu look already used in Chat (see ChatPage's
 * `.chat-menu-dropdown` / `.chat-menu-item`). Opens on click, closes on
 * outside click, Escape, or after an item is chosen.
 */
export function OptionsMenu({ items, ariaLabel = 'More options', align = 'right', triggerStyle }: OptionsMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="options-menu-wrap" ref={wrapRef}>
      <IconButton icon="dots" onClick={() => setOpen((v) => !v)} ariaLabel={ariaLabel} style={triggerStyle} />
      {open && (
        <div className={`card options-menu-dropdown${align === 'left' ? ' options-menu-dropdown-left' : ''}`}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`tap-card options-menu-item${item.danger ? ' c-danger' : ''}`}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
