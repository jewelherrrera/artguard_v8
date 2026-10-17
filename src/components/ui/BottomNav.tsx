import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../../assets/icons';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';

export type NavTab = 'home' | 'market' | 'shield' | 'chat' | 'profile';

const TABS: { key: NavTab; label: string; icon: IconName; path: string }[] = [
  { key: 'home', label: 'Home', icon: 'home', path: '/home' },
  { key: 'market', label: 'Market', icon: 'compass', path: '/market' },
  { key: 'shield', label: 'Shield', icon: 'shield', path: '/shield' },
  { key: 'chat', label: 'Chat', icon: 'chat', path: '/chat' },
  { key: 'profile', label: 'Profile', icon: 'user', path: '/profile' },
];

interface BottomNavProps {
  active: NavTab;
}

/**
 * Persistent 5-item bottom navigation, ported 1:1 from the mockup's
 * `.bottom-nav` / `.nav-item` markup and styling. Every button is a real,
 * fully clickable navigation target (react-router `navigate`, not decoration).
 */
export function BottomNav({ active }: BottomNavProps) {
  const navigate = useNavigate();
  const { totalUnread } = useChat();
  const { user } = useAuth();
  const visibleTabs = user?.role === 'artist' ? TABS : TABS.filter((tab) => tab.key !== 'shield');
  const [touchTooltip, setTouchTooltip] = useState<NavTab | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const hideTooltipTimer = useRef<number | null>(null);
  const longPressShown = useRef(false);

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    if (hideTooltipTimer.current !== null) window.clearTimeout(hideTooltipTimer.current);
  }, []);

  const startLongPress = (tab: NavTab) => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    if (hideTooltipTimer.current !== null) window.clearTimeout(hideTooltipTimer.current);
    longPressShown.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressShown.current = true;
      setTouchTooltip(tab);
    }, 500);
  };

  const endLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressShown.current) {
      hideTooltipTimer.current = window.setTimeout(() => {
        setTouchTooltip(null);
        hideTooltipTimer.current = null;
      }, 900);
    }
  };

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {visibleTabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`nav-item${tab.key === active ? ' active' : ''}${touchTooltip === tab.key ? ' show-tooltip' : ''}`}
          onClick={(event) => {
            if (longPressShown.current) {
              event.preventDefault();
              longPressShown.current = false;
              return;
            }
            navigate(tab.path);
          }}
          onTouchStart={() => startLongPress(tab.key)}
          onTouchEnd={endLongPress}
          onTouchMove={() => {
            if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
            longPressShown.current = false;
            setTouchTooltip(null);
          }}
          onTouchCancel={endLongPress}
          onContextMenu={(event) => {
            if (longPressShown.current) event.preventDefault();
          }}
          aria-current={tab.key === active ? 'page' : undefined}
          aria-label={tab.label}
          data-label={tab.label}
        >
          {tab.key === active && <span className="nav-item-active-background" aria-hidden="true" />}
          <span className="nav-item-content">
            <span className="nav-icon-wrap">
              <Icon name={tab.icon} />
              {tab.key === 'chat' && totalUnread > 0 && <span className="nav-badge">{totalUnread > 9 ? '9+' : totalUnread}</span>}
            </span>
            <span className="nav-label">{tab.label}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}
