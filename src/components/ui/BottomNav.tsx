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

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {visibleTabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`nav-item${tab.key === active ? ' active' : ''}`}
          onClick={() => navigate(tab.path)}
          aria-current={tab.key === active ? 'page' : undefined}
        >
          {tab.key === active && <span className="nav-item-active-background" aria-hidden="true" />}
          <span className="nav-item-content">
            <span className="nav-icon-wrap">
              <Icon name={tab.icon} />
              {tab.key === 'chat' && totalUnread > 0 && <span className="nav-badge">{totalUnread > 9 ? '9+' : totalUnread}</span>}
            </span>
            <span>{tab.label}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}
