import type { CSSProperties } from 'react';

export const INTEREST_OPTIONS = [
  'Chibi',
  'Digital Art',
  'Traditional Art',
  'Anime',
  'Character Design',
  'Concept Art',
  'Illustration',
  'Portraits',
] as const;

export interface CommissionRequest {
  id: string;
  title: string;
  description: string;
  budgetLabel: string;
  status: 'open' | 'in-review' | 'booked';
  createdLabel: string;
}

export const CLIENT_COMMISSION_REQUESTS: CommissionRequest[] = [
  {
    id: 'req-1',
    title: 'Fantasy OC full body',
    description: 'Looking for a painterly full-body render of my original character in armor.',
    budgetLabel: '₱2,500–₱4,000',
    status: 'open',
    createdLabel: 'Posted 3 days ago',
  },
  {
    id: 'req-2',
    title: 'Chibi couple icon set',
    description: 'Matching chibi icons for me and my partner, soft pastel palette.',
    budgetLabel: '₱900–₱1,400',
    status: 'in-review',
    createdLabel: 'Posted 1 week ago',
  },
];

export interface Artist {
  id: string;
  name: string;
  handle: string;
  initials: string;
  avatarStyle: CSSProperties;
  tags: string[];
  rating: number;
  reviewCount: number;
  completed: number;
  responseTime: string;
  bio: string;
  slots: number;
  startingPrice: number;
  pricing: { tier: string; price: number }[];
  portfolio: (1 | 2 | 3 | 4 | 5 | 6)[];
  verified?: boolean;
  coverGradient: string;
}

export interface Milestone {
  name: string;
  status: 'approved' | 'in-progress' | 'pending';
  note: string;
}

export interface Order {
  id: string;
  clientName: string;
  clientInitials: string;
  title: string;
  badgeLabel: string;
  badgeVariant: 'accent' | 'warning';
  dueLabel: string;
  progress: number;
  artVariant: 1 | 2 | 3 | 4 | 5 | 6;
  startedLabel: string;
  milestones: Milestone[];
  escrow: { total: number; released: number; held: number };
  requirementsText: string;
  requirementTiles: (1 | 2 | 3 | 4 | 5 | 6)[];
}

export type ChatMessageKind = 'text' | 'image' | 'file' | 'artwork' | 'revision';
export type MessageStatus = 'sent' | 'delivered' | 'read';
export type PresenceStatus = 'online' | 'offline' | 'recent';

export interface ChatMessage {
  id: string;
  conversationId?: string;
  from: 'me' | 'them';
  kind: ChatMessageKind;
  createdAt?: string;
  text?: string;
  imageName?: string;
  imageVariant?: 1 | 2 | 3 | 4 | 5 | 6;
  imageUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: string;
  attachmentStoragePath?: string;
  attachmentMimeType?: string;
  attachmentSizeBytes?: number;
  attachmentUrl?: string;
  artworkId?: string;
  time: string;
  /** Delivery state for outgoing ('me') messages only. */
  status?: MessageStatus;
  /** Single emoji reaction attached to this message, if any. */
  reaction?: string;
}

export interface Conversation {
  id: string;
  name: string;
  initials: string;
  avatarStyle: CSSProperties;
  avatarDataUrl?: string | null;
  presence: PresenceStatus;
  /** Shown under the name in the conversation header when not online, e.g. "Last seen yesterday". */
  lastSeenLabel?: string;
  /** Date divider shown once above this conversation's messages, e.g. "Today", "Yesterday". */
  dayLabel: string;
  /** Relative timestamp shown in the inbox list row, e.g. "9:12 AM", "Yesterday". */
  previewTime: string;
  unreadCount: number;
  messages: ChatMessage[];
  /** Real-backend conversation metadata. Optional so existing mock data remains unchanged. */
  otherUserId?: string;
  notificationsMuted?: boolean;
}

export const ARTISTS: Artist[] = [
  {
    id: 'alexa-renn',
    name: 'Alexa Renn',
    handle: '@inkwraith',
    initials: 'AR',
    avatarStyle: {},
    tags: ['Character Design', 'Anime', 'Chibi'],
    rating: 4.9,
    reviewCount: 238,
    completed: 312,
    responseTime: '<2h',
    bio: 'Full-time character illustrator specializing in expressive anime portraits and OC commissions. Every upload ships shielded — feel free to share freely.',
    slots: 2,
    startingPrice: 35,
    pricing: [
      { tier: 'Sketch', price: 35 },
      { tier: 'Flat Color', price: 65 },
      { tier: 'Full Render', price: 120 },
    ],
    portfolio: [1, 2, 3, 4, 5, 6],
    verified: true,
    coverGradient: 'linear-gradient(160deg, #1D5C8C 0%, #2E86C9 45%, #E8B23D 100%)',
  },
  {
    id: 'devan-vance',
    name: 'Devan Vance',
    handle: '@devanscapes',
    initials: 'DV',
    avatarStyle: { background: 'var(--ag-grad-accent)' },
    tags: ['Concept Art', 'Environments'],
    rating: 4.8,
    reviewCount: 151,
    completed: 204,
    responseTime: '<4h',
    bio: 'Environment and concept artist for games and film pre-production. Moody lighting, painterly finishes, always cloaked before delivery.',
    slots: 1,
    startingPrice: 90,
    pricing: [
      { tier: 'Rough Concept', price: 90 },
      { tier: 'Detailed Environment', price: 180 },
      { tier: 'Full Scene + Props', price: 260 },
    ],
    portfolio: [2, 4, 5, 1, 3, 6],
    verified: true,
    coverGradient: 'linear-gradient(160deg, #14243B 0%, #2E86C9 55%, #6C6470 100%)',
  },
  {
    id: 'suki-kaine',
    name: 'Suki Kaine',
    handle: '@sukidraws',
    initials: 'SK',
    avatarStyle: { background: 'linear-gradient(135deg,#6C6470,#1D5C8C)' },
    tags: ['Chibi', 'Icons', 'Fanart'],
    rating: 5.0,
    reviewCount: 92,
    completed: 168,
    responseTime: '<1h',
    bio: 'Chibi and icon specialist — quick turnarounds, bright palettes, and a soft spot for fandom requests. All files shielded on delivery.',
    slots: 4,
    startingPrice: 18,
    pricing: [
      { tier: 'Chibi Icon', price: 18 },
      { tier: 'Chibi Duo', price: 32 },
      { tier: 'Chibi Scene', price: 58 },
    ],
    portfolio: [3, 6, 1, 5, 2, 4],
    verified: false,
    coverGradient: 'linear-gradient(160deg, #6C6470 0%, #E8B23D 80%)',
  },
];

export const ORDERS: Order[] = [
  {
    id: 'AG-2291',
    clientName: 'Jonah P.',
    clientInitials: 'JP',
    title: 'OC character render',
    badgeLabel: 'Sketch',
    badgeVariant: 'accent',
    dueLabel: 'due in 3 days',
    progress: 45,
    artVariant: 1,
    startedLabel: 'Started Aug 14',
    milestones: [
      { name: 'Thumbnail', status: 'approved', note: 'Approved · Aug 15' },
      { name: 'Sketch', status: 'approved', note: 'Approved · Aug 18' },
      { name: 'Line Art', status: 'in-progress', note: 'In progress' },
      { name: 'Final Render', status: 'pending', note: 'Pending' },
    ],
    escrow: { total: 220, released: 80, held: 140 },
    requirementsText:
      'OC character, cyberpunk outfit, dynamic pose, cool tone lighting. No text overlay please.',
    requirementTiles: [4, 5, 6],
  },
  {
    id: 'AG-2305',
    clientName: 'Reya K.',
    clientInitials: 'RK',
    title: 'Chibi duo commission',
    badgeLabel: 'Final Render',
    badgeVariant: 'warning',
    dueLabel: 'due tomorrow',
    progress: 85,
    artVariant: 2,
    startedLabel: 'Started Aug 9',
    milestones: [
      { name: 'Thumbnail', status: 'approved', note: 'Approved · Aug 10' },
      { name: 'Sketch', status: 'approved', note: 'Approved · Aug 12' },
      { name: 'Line Art', status: 'approved', note: 'Approved · Aug 15' },
      { name: 'Final Render', status: 'in-progress', note: 'In progress' },
    ],
    escrow: { total: 150, released: 110, held: 40 },
    requirementsText: '"Two best-friend OCs, chibi style, matching pastel outfits, soft gradient background."',
    requirementTiles: [2, 3, 5],
  },
];

export const CONVERSATIONS: Conversation[] = [
  {
    id: 'conv-jonah',
    name: 'Jonah P.',
    initials: 'JP',
    avatarStyle: { background: 'var(--ag-grad-accent)' },
    presence: 'online',
    dayLabel: 'Today',
    previewTime: '9:12 AM',
    unreadCount: 0,
    messages: [
      { id: 'm1', from: 'them', kind: 'text', text: 'Hey! Just checking in on the line art 👋', time: '9:02 AM', reaction: '❤️' },
      {
        id: 'm2',
        from: 'me',
        kind: 'text',
        text: 'Almost there — uploading the update now, shielded as always 🔒',
        time: '9:05 AM',
        status: 'read',
      },
      { id: 'm3', from: 'me', kind: 'image', imageName: 'Sketch_v2.png', imageVariant: 4, time: '9:06 AM', status: 'read' },
      {
        id: 'm4',
        from: 'them',
        kind: 'revision',
        text: 'Could we adjust the left hand pose a bit?',
        time: '9:11 AM',
      },
      { id: 'm5', from: 'me', kind: 'text', text: 'On it — new version in ~2 hours!', time: '9:12 AM', status: 'delivered' },
    ],
  },
  {
    id: 'conv-alexa',
    name: 'Alexa R.',
    initials: 'AR',
    avatarStyle: { background: 'linear-gradient(135deg,#2E86C9,#6C6470)' },
    presence: 'online',
    dayLabel: 'Today',
    previewTime: '8:42 AM',
    unreadCount: 1,
    messages: [
      {
        id: 'a1',
        from: 'them',
        kind: 'text',
        text: 'Hi Maren! Quick one — think my last shielded upload glitched.',
        time: '8:40 AM',
      },
      { id: 'a2', from: 'them', kind: 'text', text: 'Can you check my artwork?', time: '8:42 AM' },
    ],
  },
  {
    id: 'conv-mika',
    name: 'Mika L.',
    initials: 'ML',
    avatarStyle: { background: 'linear-gradient(135deg,#E8B23D,#6C6470)' },
    presence: 'recent',
    lastSeenLabel: 'Active 3h ago',
    dayLabel: 'Yesterday',
    previewTime: 'Yesterday',
    unreadCount: 2,
    messages: [
      {
        id: 'k1',
        from: 'them',
        kind: 'text',
        text: 'Loved the last batch of icons! Could I get two more in the same style?',
        time: '11:02 AM',
      },
      { id: 'k2', from: 'them', kind: 'image', imageName: 'Reference_mood.png', imageVariant: 5, time: '11:04 AM' },
    ],
  },
  {
    id: 'conv-devan',
    name: 'Devan V.',
    initials: 'DV',
    avatarStyle: { background: 'linear-gradient(135deg,#6C6470,#1D5C8C)' },
    presence: 'offline',
    lastSeenLabel: 'Last seen yesterday',
    dayLabel: 'Yesterday',
    previewTime: 'Yesterday',
    unreadCount: 0,
    messages: [
      { id: 'd1', from: 'me', kind: 'text', text: "Here's the final render for the observatory concept!", time: '4:10 PM', status: 'read' },
      { id: 'd2', from: 'me', kind: 'image', imageName: 'Observatory_final.png', imageVariant: 2, time: '4:11 PM', status: 'read' },
      { id: 'd3', from: 'them', kind: 'text', text: 'Thank you!', time: '4:23 PM', reaction: '❤️' },
    ],
  },
  {
    id: 'conv-reya',
    name: 'Reya K.',
    initials: 'RK',
    avatarStyle: { background: 'linear-gradient(135deg,#1D5C8C,#E8B23D)' },
    presence: 'online',
    dayLabel: 'Aug 29',
    previewTime: '2d ago',
    unreadCount: 0,
    messages: [
      { id: 'r1', from: 'them', kind: 'text', text: 'Is the commission still available for a second chibi duo?', time: '10:15 AM' },
      { id: 'r2', from: 'me', kind: 'text', text: 'Yes! I still have one slot available.', time: '10:18 AM', status: 'read' },
      { id: 'r3', from: 'them', kind: 'file', fileName: 'Character_ref_sheet.pdf', fileType: 'PDF', fileSize: '2.1 MB', time: '10:20 AM' },
      {
        id: 'r4',
        from: 'me',
        kind: 'text',
        text: "Perfect, this gives me everything I need. I'll start on the sketch tomorrow!",
        time: '10:25 AM',
        status: 'read',
      },
    ],
  },
];

export const ACTIVITY_FEED = [
  { id: 'a1', icon: 'check-circle' as const, color: 'var(--ag-success)', text: 'Milestone approved by @rennalore', time: '2 hours ago' },
  { id: 'a2', icon: 'chat' as const, color: 'var(--ag-accent)', text: 'New commission request received', time: '5 hours ago' },
  { id: 'a3', icon: 'lock' as const, color: 'var(--ag-sky)', text: 'Payment released from escrow', time: '1 day ago' },
];

export const SCAN_LOG = [
  { id: 's1', icon: 'alert' as const, danger: true, text: 'Crawler fingerprint blocked', meta: 'GPT-Crawler/2.1 · 2 min ago' },
  { id: 's2', icon: 'check-circle' as const, danger: false, text: 'Canvas re-tiled automatically', meta: '"Moonlit Duel.png" · 1 hour ago' },
  { id: 's3', icon: 'alert' as const, danger: true, text: 'Screenshot bot blocked', meta: 'Headless Chrome · 3 hours ago' },
];

export const BLOCKED_LOG = [
  { id: 'b1', label: 'Crawler bot', level: 'danger' as const, time: '2m ago' },
  { id: 'b2', label: 'Screenshot tool', level: 'danger' as const, time: '41m ago' },
  { id: 'b3', label: 'Right-click attempt', level: 'warning' as const, time: '2h ago' },
];

export interface ArtworkComment {
  id: string;
  author: string;
  authorInitials: string;
  text: string;
  time: string;
  authorId?: string;
  authorUsername?: string | null;
  authorAvatarDataUrl?: string | null;
  createdAt?: string;
}

export interface ArtworkPost {
  id: string;
  title?: string;
  createdAt?: string;
  previewUrl?: string;
  category?: string;
  isSupabase?: boolean;
  protectionSettings?: {
    dynamic_cloaking: boolean;
    canvas_tiling: boolean;
    right_click_shield: boolean;
  };
  commentCount?: number;
  /** Links back to a full commission profile in ARTISTS, when the poster also takes commissions. */
  artistId?: string;
  artistName: string;
  artistHandle: string;
  artistInitials: string;
  avatarStyle: CSSProperties;
  /** Which of the 6 mockup gradient swatches to render as the artwork. */
  image: 1 | 2 | 3 | 4 | 5 | 6;
  /** width / height, varied per post so the Discover feed reads as a masonry grid. */
  aspectRatio: number;
  caption: string;
  tags: string[];
  likes: number;
  liked: boolean;
  postedLabel: string;
  comments: ArtworkComment[];
}

export const DISCOVER_CATEGORIES = ['All', 'Character', 'Chibi', 'Concept Art', 'Portrait', 'Fanart', 'Environment', 'Other'];

export const ARTWORK_FEED: ArtworkPost[] = [
  {
    id: 'post-1',
    artistId: 'alexa-renn',
    artistName: 'Alexa Renn',
    artistHandle: '@inkwraith',
    artistInitials: 'AR',
    avatarStyle: {},
    image: 1,
    aspectRatio: 0.78,
    caption: 'Moonlit duel redraw — pushed the rim light way further this time. Shielded before upload as always 🔒',
    tags: ['Character', 'Portrait'],
    likes: 214,
    liked: false,
    postedLabel: '2h ago',
    comments: [
      { id: 'c1-1', author: 'Reya K.', authorInitials: 'RK', text: 'The lighting on this is unreal 😍', time: '1h ago' },
      { id: 'c1-2', author: 'Jonah P.', authorInitials: 'JP', text: 'Okay the rim light is SO good', time: '42m ago' },
    ],
  },
  {
    id: 'post-2',
    artistId: 'devan-vance',
    artistName: 'Devan Vance',
    artistHandle: '@devanscapes',
    artistInitials: 'DV',
    avatarStyle: { background: 'var(--ag-grad-accent)' },
    image: 2,
    aspectRatio: 1.3,
    caption: 'Abandoned observatory concept for a personal sci-fi project. Three lighting passes deep.',
    tags: ['Concept Art', 'Environment'],
    likes: 356,
    liked: true,
    postedLabel: '5h ago',
    comments: [
      { id: 'c2-1', author: 'Mika T.', authorInitials: 'MT', text: 'The scale on this is incredible', time: '3h ago' },
    ],
  },
  {
    id: 'post-3',
    artistId: 'suki-kaine',
    artistName: 'Suki Kaine',
    artistHandle: '@sukidraws',
    artistInitials: 'SK',
    avatarStyle: { background: 'linear-gradient(135deg,#6C6470,#1D5C8C)' },
    image: 3,
    aspectRatio: 0.9,
    caption: 'Chibi commission batch, round 2! Taking 3 more slots this week 🎀',
    tags: ['Chibi', 'Fanart'],
    likes: 189,
    liked: false,
    postedLabel: '7h ago',
    comments: [
      { id: 'c3-1', author: 'Priya O.', authorInitials: 'PO', text: 'The pastel palette is so cute', time: '5h ago' },
      { id: 'c3-2', author: 'Devan V.', authorInitials: 'DV', text: 'These never miss', time: '4h ago' },
      { id: 'c3-3', author: 'Alexa R.', authorInitials: 'AR', text: 'Taking notes on this palette 👀', time: '2h ago' },
    ],
  },
  {
    id: 'post-4',
    artistName: 'Priya Osei',
    artistHandle: '@priyaocean',
    artistInitials: 'PO',
    avatarStyle: { background: 'linear-gradient(135deg,#2E86C9,#6C6470)' },
    image: 4,
    aspectRatio: 1.05,
    caption: 'Study of an underwater ruin. Wanted the light to feel like it was filtering through moving water.',
    tags: ['Environment', 'Concept Art'],
    likes: 132,
    liked: false,
    postedLabel: '9h ago',
    comments: [
      { id: 'c4-1', author: 'Lena V.', authorInitials: 'LV', text: 'That color grading!!', time: '8h ago' },
    ],
  },
  {
    id: 'post-5',
    artistName: 'Mateo Cruz',
    artistHandle: '@cruzworks',
    artistInitials: 'MC',
    avatarStyle: { background: 'linear-gradient(135deg,#E8B23D,#6C6470)' },
    image: 5,
    aspectRatio: 0.72,
    caption: 'OC portrait commission — full render, soft studio lighting.',
    tags: ['Portrait', 'Character'],
    likes: 98,
    liked: false,
    postedLabel: '11h ago',
    comments: [],
  },
  {
    id: 'post-6',
    artistName: 'Lena Voss',
    artistHandle: '@lenavoss',
    artistInitials: 'LV',
    avatarStyle: { background: 'linear-gradient(135deg,#1D5C8C,#E8B23D)' },
    image: 6,
    aspectRatio: 1.2,
    caption: 'Fanart of my favorite indie game duo. Tried a looser inking style this round.',
    tags: ['Fanart', 'Character'],
    likes: 271,
    liked: false,
    postedLabel: '1d ago',
    comments: [
      { id: 'c6-1', author: 'Suki K.', authorInitials: 'SK', text: 'That inking style suits them so well', time: '20h ago' },
      { id: 'c6-2', author: 'Mateo C.', authorInitials: 'MC', text: 'Immediately recognized who this is 😄', time: '14h ago' },
    ],
  },
  {
    id: 'post-7',
    artistId: 'alexa-renn',
    artistName: 'Alexa Renn',
    artistHandle: '@inkwraith',
    artistInitials: 'AR',
    avatarStyle: {},
    image: 2,
    aspectRatio: 0.85,
    caption: 'Chibi warmup before starting the day\'s queue. Free-to-share, shielded on export.',
    tags: ['Chibi', 'Character'],
    likes: 74,
    liked: false,
    postedLabel: '1d ago',
    comments: [],
  },
  {
    id: 'post-8',
    artistName: 'Priya Osei',
    artistHandle: '@priyaocean',
    artistInitials: 'PO',
    avatarStyle: { background: 'linear-gradient(135deg,#2E86C9,#6C6470)' },
    image: 6,
    aspectRatio: 1.1,
    caption: 'Environment sketch — floating market at dusk. More lighting studies coming this week.',
    tags: ['Environment'],
    likes: 156,
    liked: false,
    postedLabel: '2d ago',
    comments: [
      { id: 'c8-1', author: 'Reya K.', authorInitials: 'RK', text: 'The composition here is so strong', time: '1d ago' },
    ],
  },
  {
    id: 'post-9',
    artistId: 'devan-vance',
    artistName: 'Devan Vance',
    artistHandle: '@devanscapes',
    artistInitials: 'DV',
    avatarStyle: { background: 'var(--ag-grad-accent)' },
    image: 4,
    aspectRatio: 0.95,
    caption: 'Concept pass for a forgotten shrine. Trying out a colder palette than usual.',
    tags: ['Concept Art', 'Environment'],
    likes: 203,
    liked: false,
    postedLabel: '2d ago',
    comments: [],
  },
];

export const CURRENT_ARTIST = {
  name: 'Maren',
  fullName: 'Maren Oyelaran',
  handle: '@marenmakes',
  initials: 'M',
  tags: ['Character Design', 'Portraits'],
  rating: 4.9,
  reviewCount: 184,
  completed: 227,
  responseTime: '<3h',
  bio: 'Portrait and character artist. Every commission ships shielded — clients can share freely without risking the source file.',
  portfolio: [5, 3, 1, 6, 2, 4] as (1 | 2 | 3 | 4 | 5 | 6)[],
  pricing: [
    { tier: 'Sketch', price: 40 },
    { tier: 'Flat Color', price: 75 },
    { tier: 'Full Render', price: 140 },
  ],
};
