import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../assets/icons';
import { useChat } from '../../context/ChatContext';
import { previewFor } from '../../utils/chat';
import { ConversationRow } from './ConversationRow';
import './ChatSidebar.css';

interface ChatSidebarProps {
  /** The conversation currently open in the right-hand pane, if any. */
  activeId?: string;
}

/**
 * Persistent conversation list for desktop widths (see .chat-sidebar,
 * >=1024px) — rendered alongside both ChatInboxPage and ChatPage so
 * opening a conversation on a wide screen feels like a real two-pane
 * messaging app (Messenger/Telegram) instead of navigating away from the
 * list entirely. Hidden completely below the desktop breakpoint, where
 * ChatInboxPage's own full-width list is what's shown instead.
 *
 * Deliberately a self-contained duplicate of ChatInboxPage's list (own
 * search state, same ConversationRow) rather than a shared route/outlet:
 * IonRouterOutlet requires its <Route> children to stay flat (see
 * AppRoutes.tsx), so /chat and /chat/:conversationId can't be nested under
 * a shared layout route. Both routes rendering this pane independently
 * gets the same visual result without touching routing.
 */
export function ChatSidebar({ activeId }: ChatSidebarProps) {
  const navigate = useNavigate();
  const { conversations, searchUsers, startConversation } = useChat();
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Awaited<ReturnType<typeof searchUsers>>>([]);
  const [searchingPeople, setSearchingPeople] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const term = search.trim();
    if (term.length < 2) {
      setPeople([]);
      setSearchingPeople(false);
      return;
    }
    setSearchingPeople(true);
    const timer = window.setTimeout(async () => {
      const found = await searchUsers(term);
      if (!cancelled) {
        setPeople(found);
        setSearchingPeople(false);
      }
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, searchUsers]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) => c.name.toLowerCase().includes(term) || previewFor(c).toLowerCase().includes(term));
  }, [conversations, search]);
  const hasSearch = search.trim().length > 0;

  const openConversation = (id: string) => {
    // Read/seen is owned by the active ChatPage. The sidebar can render
    // cached/inactive conversation rows (especially with IonRouterOutlet),
    // so it must never mark a thread read just because a row was clicked.
    navigate(`/chat/${id}`);
  };

  return (
    <aside className="chat-sidebar" aria-label="Conversations">
      <div className="chat-sidebar-hd">
        <span className="h-title" style={{ fontSize: 20 }}>
          Messages
        </span>
        <div className="search-bar" style={{ marginTop: 12 }}>
          <Icon name="search" style={{ width: 15, height: 15 }} />
          <input
            type="text"
            placeholder="Search messages…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search messages"
          />
        </div>
        {search.trim().length >= 2 && (
          <div className="card" style={{ marginTop: 10, padding: 8 }}>
            <div className="t-xs c-low fw-700" style={{ padding: '4px 6px 7px' }}>People</div>
            {searchingPeople ? (
              <div className="t-xs c-low" style={{ padding: '8px 6px' }}>Searching…</div>
            ) : people.length ? (
              people.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="tap-card"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 6px', border: 0, background: 'transparent', textAlign: 'left' }}
                  onClick={async () => {
                    const id = await startConversation(person.id);
                    if (id) {
                      setSearch('');
                      setPeople([]);
                      navigate(`/chat/${id}`);
                    }
                  }}
                >
                  <div className="avatar avatar-sm">{person.name.slice(0, 2).toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t-xs fw-700">{person.name}</div>
                    <div className="t-xs c-low">@{person.username}</div>
                    <div className="row gap-6" style={{ marginTop: 2 }}>
                      <span className={`presence-dot-inline ${person.is_online ? 'presence-online' : 'presence-recent'}`} />
                      <span className="t-xs c-low">{person.is_online ? 'Active now' : 'Available to message'}</span>
                    </div>
                  </div>
                  <Icon name="chevron-r" style={{ width: 13, height: 13, stroke: 'var(--ag-text-low)' }} />
                </button>
              ))
            ) : (
              <div className="t-xs c-low" style={{ padding: '8px 6px' }}>No users found.</div>
            )}
          </div>
        )}
      </div>

      <div className="chat-sidebar-list">
        {filtered.length === 0 ? (
          <div className="t-sm c-mid" style={{ textAlign: 'center', padding: '20px 14px' }}>
            {hasSearch ? 'No conversations match that search.' : 'No conversations yet.'}
          </div>
        ) : (
          filtered.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              onOpen={openConversation}
            />
          ))
        )}
      </div>
    </aside>
  );
}
