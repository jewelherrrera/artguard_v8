import { supabase, supabasePublishableKey, supabaseUrl } from './supabase';

export const CHAT_ATTACHMENT_BUCKET = 'chat-attachments';
export const MAX_CHAT_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const FILE_TYPES = new Map([
  ['application/pdf', 'PDF'],
  ['text/plain', 'TXT'],
  ['text/rtf', 'RTF'],
  ['application/rtf', 'RTF'],
  ['application/msword', 'DOC'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'DOCX'],
  ['application/vnd.ms-excel', 'XLS'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX'],
  ['application/vnd.ms-powerpoint', 'PPT'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PPTX'],
  ['application/zip', 'ZIP'],
]);

export type ChatAttachmentKind = 'image' | 'file';

export function getChatAttachmentKind(file: File): ChatAttachmentKind | undefined {
  if (IMAGE_TYPES.has(file.type.toLowerCase())) return 'image';
  if (FILE_TYPES.has(file.type.toLowerCase())) return 'file';
  return undefined;
}

export function validateChatAttachment(file: File): string | undefined {
  const kind = getChatAttachmentKind(file);
  if (!kind) {
    return 'Choose a JPG, PNG, WebP, or GIF image, or a PDF, text, Office, or ZIP document.';
  }
  const maxBytes = kind === 'image' ? MAX_CHAT_IMAGE_BYTES : MAX_CHAT_FILE_BYTES;
  if (file.size <= 0 || file.size > maxBytes) {
    return kind === 'image'
      ? 'Images must be 15 MB or smaller.'
      : 'Files must be 20 MB or smaller.';
  }
  return undefined;
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getAttachmentTypeLabel(file: File): string {
  return FILE_TYPES.get(file.type.toLowerCase()) ?? file.type.split('/').at(-1)?.toUpperCase() ?? 'FILE';
}

export function safeAttachmentFilename(fileName: string): string {
  const base = fileName.split(/[\\/]/).at(-1)?.replace(/\p{Cc}/gu, '').trim().slice(0, 180);
  return base || 'attachment';
}

function pathExtension(file: File): string {
  const extension = safeAttachmentFilename(file.name).match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase();
  if (extension) return extension;
  return getAttachmentTypeLabel(file).toLowerCase();
}

export function createChatAttachmentStoragePath(
  conversationId: string,
  userId: string,
  clientMessageId: string,
  file: File,
): string {
  return `${conversationId}/${userId}/${clientMessageId}.${pathExtension(file)}`;
}

export async function uploadChatAttachment(
  path: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const client = supabase;
  if (!client || !supabaseUrl || !supabasePublishableKey) {
    throw new Error('Secure chat attachment storage is not configured.');
  }
  const validationError = validateChatAttachment(file);
  if (validationError) throw new Error(validationError);

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Sign in again before uploading an attachment.');

  const objectPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${CHAT_ATTACHMENT_BUCKET}/${objectPath}`;

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    request.setRequestHeader('apikey', supabasePublishableKey);
    request.setRequestHeader('Content-Type', file.type);
    request.setRequestHeader('x-upsert', 'false');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error('The upload could not reach secure storage. Check your connection and try again.'));
    request.onabort = () => reject(new Error('The upload was cancelled.'));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      let message = `Secure upload failed (${request.status}).`;
      try {
        const response = JSON.parse(request.responseText) as { message?: string; error?: string };
        message = response.message ?? response.error ?? message;
      } catch {
        // Keep the explicit HTTP error if Storage did not return JSON.
      }
      reject(new Error(message));
    };
    request.send(file);
  });
}

export async function removeChatAttachment(path: string): Promise<void> {
  if (!supabase) throw new Error('Secure chat attachment storage is not configured.');
  const { error } = await supabase.storage.from(CHAT_ATTACHMENT_BUCKET).remove([path]);
  if (error) throw error;
}

export async function createChatAttachmentSignedUrl(path: string, download?: string): Promise<string> {
  if (!supabase) throw new Error('Secure chat attachment storage is not configured.');
  const { data, error } = await supabase.storage
    .from(CHAT_ATTACHMENT_BUCKET)
    .createSignedUrl(path, 60 * 60, download ? { download: safeAttachmentFilename(download) } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
