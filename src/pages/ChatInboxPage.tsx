import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { BottomNav } from '../components/ui/BottomNav';
import { Icon } from '../assets/icons';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import { previewFor } from '../utils/chat';
import { ConversationRow } from '../components/chat/ConversationRow';
import { ChatSidebar } from '../components/chat/ChatSidebar';
import './ChatInboxPage.css';

export function ChatInboxPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { conversations, searchUsers, startConversation } = useChat();
  const [isDesktopLayout, setIsDesktopLayout] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1100px)').matches,
  );
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Awaited<ReturnType<typeof searchUsers>>>([]);
  const [searchingPeople, setSearchingPeople] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) => c.name.toLowerCase().includes(term) || previewFor(c).toLowerCase().includes(term));
  }, [conversations, search]);
  const hasSearch = search.trim().length > 0;
  const isInboxRoute = location.pathname.replace(/\/+$/, '') === '/chat';

  useEffect(() => {
    const desktopMedia = window.matchMedia('(min-width: 1100px)');
    const updateDesktopLayout = () => setIsDesktopLayout(desktopMedia.matches);
    updateDesktopLayout();
    desktopMedia.addEventListener('change', updateDesktopLayout);
    return () => desktopMedia.removeEventListener('change', updateDesktopLayout);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const term = search.trim();
    if (!user || term.length < 2) {
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
  }, [search, searchUsers, user]);

  const openConversation = (id: string) => {
    // Read/seen is intentionally handled by ChatPage only after the thread
    // is actually opened and rendered. Do not mark it read from the inbox.
    navigate(`/chat/${id}`);
  };

  const openUser = async (userId: string) => {
    const id = await startConversation(userId);
    if (id) {
      setSearch('');
      setPeople([]);
      navigate(`/chat/${id}`);
    }
  };

  return (
    <ScreenShell
      aside={<ChatSidebar />}
      contentClassName="chat-inbox-content"
      header={
        <div className="px-hd chat-inbox-hd">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <span className="h-title">Messages</span>
            <span className="t-xs c-low">{conversations.length} conversation{conversations.length === 1 ? '' : 's'}</span>
          </div>
          <div className="search-bar">
            <Icon name="search" style={{ width: 16, height: 16 }} />
            <input
              type="text"
              placeholder="Search messages or people…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search messages or people"
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
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', border: 0, background: 'transparent', textAlign: 'left' }}
                    onClick={() => void openUser(person.id)}
                  >
                    <ProfileAvatar
                      className="avatar avatar-sm"
                      imageUrl={person.avatar_data_url}
                      initials={person.name.slice(0, 2).toUpperCase()}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row gap-8">
                        <span className="t-sm fw-700">{person.name}</span>
                        <span className="t-xs c-low" style={{ textTransform: 'capitalize' }}>{person.role}</span>
                      </div>
                      <div className="row gap-6" style={{ marginTop: 2 }}>
                        <span className={`presence-dot-inline ${person.is_online ? 'presence-online' : 'presence-recent'}`} />
                        <span className="t-xs c-low">{person.is_online ? 'Active now' : 'Available to message'}</span>
                      </div>
                    </div>
                    <Icon name="chevron-r" style={{ width: 15, height: 15, stroke: 'var(--ag-text-low)' }} />
                  </button>
                ))
              ) : (
                <div className="t-xs c-low" style={{ padding: '8px 6px' }}>No registered users match “{search.trim()}”.</div>
              )}
            </div>
          )}
        </div>
      }
      footer={<BottomNav active="chat" />}
    >
      <div className="chat-inbox-layout">
        <div className="chat-inbox-mobile-list">
          {filtered.length === 0 ? (
            hasSearch ? (
              <div className="t-sm c-mid chat-inbox-list-empty" role="status">
                No conversations match that search.
              </div>
            ) : (
              <div className="chat-inbox-desktop-empty chat-inbox-mobile-empty" role="status">
                <Icon name="chat" style={{ width: 44, height: 44, stroke: 'var(--ag-text-low)' }} />
                <p className="t-sm c-mid" style={{ marginTop: 14 }}>Select a conversation to start messaging</p>
              </div>
            )
          ) : (
            <div className="chat-list">
              {filtered.map((conversation) => (
                <ConversationRow key={conversation.id} conversation={conversation} onOpen={openConversation} />
              ))}
            </div>
          )}
        </div>

        {isDesktopLayout && isInboxRoute && (
          <div className="chat-inbox-desktop-empty" role="status">
            <Icon name="chat" style={{ width: 44, height: 44, stroke: 'var(--ag-text-low)' }} />
            <p className="t-sm c-mid" style={{ marginTop: 14 }}>Select a conversation to start messaging</p>
          </div>
        )}
      </div>
    </ScreenShell>
  );
}
