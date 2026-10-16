/**
 * Mock automatic-reply generator for the Chat feature. There is no real
 * backend/AI here — this just picks a plausible canned response so a
 * conversation never feels dead while testing the prototype. Keyword rules
 * are checked in order; the first match wins. Anything else rotates through
 * a small pool of generic acknowledgements so replies don't feel identical
 * every time.
 */

const KEYWORD_REPLIES: { pattern: RegExp; reply: string }[] = [
  { pattern: /\b(hi|hello|hey)\b/i, reply: 'Hey! 👋' },
  { pattern: /\b(sketch|draft|line ?art|wip|progress)\b/i, reply: "Sure! I'll check it now 👍" },
  { pattern: /\b(available|slot|open|book)\b/i, reply: 'Yes! I still have one slot available.' },
  { pattern: /\bthank/i, reply: 'No problem! 😊' },
  { pattern: /\b(revision|adjust|change|fix|redo)\b/i, reply: "Got it, I'll work on that revision." },
  { pattern: /\b(price|cost|how much|rate|budget)\b/i, reply: 'Let me get back to you with the pricing details.' },
  { pattern: /\b(when|eta|done|ready|finish)\b/i, reply: "I'm aiming to have it ready soon!" },
];

const FALLBACK_REPLIES = [
  'Awesome, thanks for the update!',
  'Got it 👍',
  'Sounds good to me!',
  'Noted, appreciate it!',
  'Looks great! I really like the updated version.',
];

const ATTACHMENT_REPLIES = ['Got the file, thanks! Taking a look now 🔍', 'Received — this looks great so far!', 'Thanks for sending that over, checking it now.'];

let fallbackIndex = 0;
let attachmentIndex = 0;

/** Picks a reply for an outgoing text message, matched by keyword or rotated from a fallback pool. */
export function getAutoReply(text: string): string {
  const match = KEYWORD_REPLIES.find((entry) => entry.pattern.test(text));
  if (match) return match.reply;
  const reply = FALLBACK_REPLIES[fallbackIndex % FALLBACK_REPLIES.length];
  fallbackIndex += 1;
  return reply;
}

/** Picks a reply for an outgoing image/file message. */
export function getAttachmentAutoReply(): string {
  const reply = ATTACHMENT_REPLIES[attachmentIndex % ATTACHMENT_REPLIES.length];
  attachmentIndex += 1;
  return reply;
}
