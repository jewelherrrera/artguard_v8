import type { Conversation } from '../data/mockData';

/**
 * Last-message preview line shown in an inbox row. Shared by ChatInboxPage
 * (mobile + desktop list) and ChatSidebar (desktop persistent pane) so the
 * two never drift apart.
 */
export function previewFor(conversation: Conversation): string {
  const last = conversation.messages[conversation.messages.length - 1];
  if (!last) return '';
  const mine = last.from === 'me' ? 'You: ' : '';
  if (last.kind === 'image') return `${mine}Sent an image`;
  if (last.kind === 'file') return `${mine}Sent a file · ${last.fileName ?? ''}`;
  if (last.kind === 'revision') return `${mine}Revision requested`;
  return `${mine}${last.text ?? ''}`;
}
