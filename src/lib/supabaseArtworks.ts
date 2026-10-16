import { supabase } from './supabase';
import { recordProtectionEvent } from './supabaseProtection';

export const ARTWORK_BUCKET = 'artworks';
export const MAX_ARTWORK_BYTES = 40 * 1024 * 1024;
export const ARTWORK_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

export type ArtworkProtectionLevel = 'standard' | 'enhanced' | 'maximum';
export type ArtworkStatus = 'original_uploaded' | 'processing' | 'ready' | 'failed';
export const ARTWORK_CATEGORIES = ['Character', 'Chibi', 'Concept Art', 'Portrait', 'Fanart', 'Environment', 'Other'] as const;
export type ArtworkCategory = (typeof ARTWORK_CATEGORIES)[number];
export type ArtworkVisibility = 'private' | 'portfolio' | 'discover';

export interface ArtworkRecord {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  category: ArtworkCategory;
  visibility: ArtworkVisibility;
  original_storage_path: string;
  protected_storage_path: string | null;
  protection_level: ArtworkProtectionLevel;
  status: ArtworkStatus;
  original_filename: string;
  mime_type: (typeof ARTWORK_MIME_TYPES)[number];
  file_size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface PublicArtworkRecord {
  id: string;
  title: string;
  description: string | null;
  protected_storage_path: string;
  created_at: string;
  dynamic_cloaking: boolean;
  canvas_tiling: boolean;
  right_click_shield: boolean;
}

export interface DiscoverArtworkRecord extends PublicArtworkRecord {
  category: ArtworkCategory;
  artist_id: string;
  artist_name: string;
  artist_username: string;
  artist_avatar_data_url: string | null;
}

export interface DiscoverArtwork {
  record: DiscoverArtworkRecord;
  previewUrl: string;
}

export interface DiscoverArtworkEngagement {
  artwork_id: string;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
}

export interface DiscoverArtworkComment {
  id: string;
  artwork_id: string;
  author_id: string;
  author_name: string;
  author_username: string;
  author_avatar_data_url: string | null;
  body: string;
  created_at: string;
}

export interface DiscoverArtworkLikeResult {
  like_count: number;
  liked_by_me: boolean;
}

export function validateArtworkFile(file: File): string | undefined {
  if (!ARTWORK_MIME_TYPES.includes(file.type as (typeof ARTWORK_MIME_TYPES)[number])) {
    return 'Only JPG and PNG artwork files are supported.';
  }
  if (file.size <= 0 || file.size > MAX_ARTWORK_BYTES) {
    return 'Artwork files must be smaller than 40MB.';
  }
  return undefined;
}

function safeFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^/.]+$/, '');
  const cleaned = withoutExtension
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || 'artwork';
}

function fileExtension(file: File): 'jpg' | 'png' {
  return file.type === 'image/png' ? 'png' : 'jpg';
}

function randomId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The uploaded artwork could not be decoded for protection processing.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: ArtworkRecord['mime_type']): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The protected artwork derivative could not be generated.'));
    }, mimeType, mimeType === 'image/jpeg' ? 0.92 : undefined);
  });
}

function drawOwnershipTreatment(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  protectionLevel: ArtworkProtectionLevel,
): void {
  if (protectionLevel === 'standard') return;
  const fontSize = Math.max(12, Math.round(Math.min(width, height) * 0.025));
  const padding = Math.max(8, Math.round(fontSize * 0.65));
  const label = 'ArtGuard protected preview';
  context.font = `600 ${fontSize}px sans-serif`;
  const labelWidth = context.measureText(label).width;
  const x = width - labelWidth - padding * 2;
  const y = height - fontSize - padding * 2;
  context.fillStyle = 'rgba(8, 13, 27, 0.62)';
  context.fillRect(x, y, labelWidth + padding * 2, fontSize + padding * 2);
  context.fillStyle = 'rgba(255, 255, 255, 0.9)';
  context.fillText(label, x + padding, y + fontSize + padding);

  if (protectionLevel === 'maximum') {
    context.save();
    context.globalAlpha = 0.22;
    context.translate(width / 2, height / 2);
    context.rotate(-Math.PI / 8);
    context.textAlign = 'center';
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    const spacing = Math.max(fontSize * 4, 96);
    for (let row = -height; row < height; row += spacing) {
      context.fillText('ARTGUARD PROTECTED', 0, row);
    }
    context.restore();
  }
}

async function setArtworkProcessingState(
  artworkId: string,
  ownerId: string,
  status: ArtworkStatus,
  protectedStoragePath: string | null,
): Promise<void> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { error } = await supabase
    .from('artworks')
    .update({ status, protected_storage_path: protectedStoragePath })
    .eq('id', artworkId)
    .eq('owner_id', ownerId);
  if (error) throw error;
}

export async function processArtworkProtection(
  ownerId: string,
  artwork: ArtworkRecord,
): Promise<ArtworkRecord> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  let protectedPath: string | null = null;
  try {
    await setArtworkProcessingState(artwork.id, ownerId, 'processing', null);
    await recordProtectionEvent(artwork.id, ownerId, 'protection_processing_started', {
      protection_level: artwork.protection_level,
    });
    const originalUrl = await createArtworkOriginalSignedUrl(artwork.id, ownerId, 120);
    const originalResponse = await fetch(originalUrl);
    if (!originalResponse.ok) throw new Error('The private original could not be loaded for processing.');
    const image = await loadImageFromBlob(await originalResponse.blob());
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not create a protection canvas.');
    context.drawImage(image, 0, 0);
    drawOwnershipTreatment(context, canvas.width, canvas.height, artwork.protection_level);
    const derivative = await canvasToBlob(canvas, artwork.mime_type);
    const protectedExtension = artwork.mime_type === 'image/png' ? 'png' : 'jpg';
    protectedPath = `${ownerId}/protected/${randomId()}-${safeFilename(artwork.original_filename)}.${protectedExtension}`;
    const { error: uploadError } = await supabase.storage
      .from(ARTWORK_BUCKET)
      .upload(protectedPath, derivative, { cacheControl: '3600', contentType: artwork.mime_type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    await setArtworkProcessingState(artwork.id, ownerId, 'ready', protectedPath);
    await recordProtectionEvent(artwork.id, ownerId, 'protection_processing_completed', {
      protection_level: artwork.protection_level,
      protected_storage_path: protectedPath,
    });
    return { ...artwork, protected_storage_path: protectedPath, status: 'ready' };
  } catch (error) {
    if (protectedPath) await supabase.storage.from(ARTWORK_BUCKET).remove([protectedPath]);
    const message = error instanceof Error ? error.message : 'Protection processing failed.';
    try {
      await setArtworkProcessingState(artwork.id, ownerId, 'failed', null);
      await recordProtectionEvent(artwork.id, ownerId, 'protection_processing_failed', {
        protection_level: artwork.protection_level,
        error: message,
      });
    } catch {
      // Preserve the original processing error for the upload flow.
    }
    throw new Error(message);
  }
}

export async function createProtectedDerivativeFromSignedUrl(
  originalUrl: string,
  mimeType: ArtworkRecord['mime_type'],
  protectedPath: string,
  protectionLevel: ArtworkProtectionLevel = 'standard',
): Promise<string> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const originalResponse = await fetch(originalUrl);
  if (!originalResponse.ok) throw new Error('The private original could not be loaded for processing.');
  const image = await loadImageFromBlob(await originalResponse.blob());
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create a protection canvas.');
  context.drawImage(image, 0, 0);
  drawOwnershipTreatment(context, canvas.width, canvas.height, protectionLevel);
  const derivative = await canvasToBlob(canvas, mimeType);
  const { error } = await supabase.storage
    .from(ARTWORK_BUCKET)
    .upload(protectedPath, derivative, { cacheControl: '3600', contentType: mimeType, upsert: false });
  if (error) throw error;
  return protectedPath;
}

export async function updateArtworkProtectionLevel(
  artworkId: string,
  ownerId: string,
  protectionLevel: ArtworkProtectionLevel,
): Promise<ArtworkRecord> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { data, error } = await supabase
    .from('artworks')
    .update({ protection_level: protectionLevel })
    .eq('id', artworkId)
    .eq('owner_id', ownerId)
    .select('*')
    .single();
  if (error) throw error;
  return data as ArtworkRecord;
}

export async function updateMyArtworkMetadata(
  artworkId: string,
  title: string,
  description: string,
): Promise<ArtworkRecord> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { data, error } = await supabase.rpc('update_my_artwork_metadata', {
    p_artwork_id: artworkId,
    p_title: title.trim(),
    p_description: description.trim(),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Artwork metadata was not returned by Supabase.');
  return row as ArtworkRecord;
}

export async function uploadArtwork(
  ownerId: string,
  file: File,
  protectionLevel: ArtworkProtectionLevel = 'standard',
  category: ArtworkCategory = 'Other',
): Promise<ArtworkRecord> {
  if (!supabase) throw new Error('Secure artwork storage is not configured. Run the Supabase artwork migration first.');
  if (!ownerId) throw new Error('You must be signed in to upload artwork.');

  const validation = validateArtworkFile(file);
  if (validation) throw new Error(validation);

  const path = `${ownerId}/${randomId()}-${safeFilename(file.name)}.${fileExtension(file)}`;
  const { error: uploadError } = await supabase.storage
    .from(ARTWORK_BUCKET)
    .upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false });

  if (uploadError) throw new Error(uploadError.message);

  const title = file.name.replace(/\.[^/.]+$/, '').trim() || 'Untitled artwork';
  const { data, error: recordError } = await supabase
    .from('artworks')
    .insert({
      owner_id: ownerId,
      title,
      category,
      visibility: 'private',
      original_filename: file.name,
      original_storage_path: path,
      protection_level: protectionLevel,
      status: 'original_uploaded',
      mime_type: file.type,
      file_size_bytes: file.size,
    })
    .select('*')
    .single();

  if (recordError) {
    await supabase.storage.from(ARTWORK_BUCKET).remove([path]);
    throw new Error(recordError.message);
  }

  return processArtworkProtection(ownerId, data as ArtworkRecord);
}

export async function countMyArtworks(ownerId: string): Promise<number> {
  if (!supabase || !ownerId) return 0;
  const { count, error } = await supabase
    .from('artworks')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId);
  if (error) throw error;
  return count ?? 0;
}

export async function listMyArtworks(ownerId: string): Promise<ArtworkRecord[]> {
  if (!supabase || !ownerId) return [];
  const { data, error } = await supabase
    .from('artworks')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ArtworkRecord[];
}

export async function listPublicArtistArtworks(artistId: string): Promise<PublicArtworkRecord[]> {
  if (!supabase || !artistId) return [];
  const { data, error } = await supabase.rpc('list_public_artist_artworks', { p_artist_id: artistId });
  if (error) throw error;
  return (data ?? []) as PublicArtworkRecord[];
}

export async function updateMyArtworkVisibility(
  artworkId: string,
  visibility: ArtworkVisibility,
): Promise<ArtworkVisibility> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { data, error } = await supabase.rpc('update_my_artwork_visibility', {
    p_artwork_id: artworkId,
    p_visibility: visibility,
  });
  if (error) throw error;
  if (data !== visibility) throw new Error('Supabase did not confirm the saved publication setting.');
  return data;
}

export async function listDiscoverArtworks(): Promise<DiscoverArtwork[]> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { data, error } = await supabase.rpc('list_discover_artworks');
  if (error) throw error;

  return Promise.all(((data ?? []) as DiscoverArtworkRecord[]).map(async (record) => ({
    record,
    previewUrl: await createPublicPortfolioSignedUrl(record.artist_id, record),
  })));
}

export async function listDiscoverArtworkEngagement(): Promise<DiscoverArtworkEngagement[]> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { data, error } = await supabase.rpc('list_discover_artwork_engagement');
  if (error) throw error;
  return ((data ?? []) as DiscoverArtworkEngagement[]).map((item) => ({
    ...item,
    like_count: Number(item.like_count),
    comment_count: Number(item.comment_count),
    liked_by_me: Boolean(item.liked_by_me),
  }));
}

export async function setDiscoverArtworkLike(
  artworkId: string,
  liked: boolean,
): Promise<DiscoverArtworkLikeResult> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { data, error } = await supabase.rpc('set_discover_artwork_like', {
    p_artwork_id: artworkId,
    p_liked: liked,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Supabase did not return the saved like state.');
  return {
    like_count: Number(row.like_count),
    liked_by_me: Boolean(row.liked_by_me),
  };
}

export async function listDiscoverArtworkComments(artworkId: string): Promise<DiscoverArtworkComment[]> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { data, error } = await supabase.rpc('list_discover_artwork_comments', {
    p_artwork_id: artworkId,
  });
  if (error) throw error;
  return (data ?? []) as DiscoverArtworkComment[];
}

export async function createDiscoverArtworkComment(
  artworkId: string,
  body: string,
): Promise<DiscoverArtworkComment> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const trimmedBody = body.trim();
  if (!trimmedBody) throw new Error('Comment cannot be empty.');
  if (Array.from(trimmedBody).length > 2000) throw new Error('Comments must be 2,000 characters or fewer.');
  const { data, error } = await supabase.rpc('create_discover_artwork_comment', {
    p_artwork_id: artworkId,
    p_body: trimmedBody,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Supabase did not return the saved comment.');
  return row as DiscoverArtworkComment;
}

export async function createArtworkOriginalSignedUrl(
  artworkId: string,
  ownerId: string,
  expiresInSeconds = 60,
): Promise<string> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { data: artwork, error: recordError } = await supabase
    .from('artworks')
    .select('original_storage_path')
    .eq('id', artworkId)
    .eq('owner_id', ownerId)
    .single();
  if (recordError) throw recordError;

  const { data, error } = await supabase.storage
    .from(ARTWORK_BUCKET)
    .createSignedUrl(artwork.original_storage_path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function createArtworkProtectedSignedUrl(
  artworkId: string,
  ownerId: string,
  expiresInSeconds = 60,
): Promise<string> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { data: artwork, error: recordError } = await supabase
    .from('artworks')
    .select('protected_storage_path')
    .eq('id', artworkId)
    .eq('owner_id', ownerId)
    .single();
  if (recordError) throw recordError;
  if (!artwork.protected_storage_path) throw new Error('This protected preview is not ready yet.');

  const { data, error } = await supabase.storage
    .from(ARTWORK_BUCKET)
    .createSignedUrl(artwork.protected_storage_path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function createPublicPortfolioSignedUrl(
  artistId: string,
  artwork: PublicArtworkRecord,
  expiresInSeconds = 60,
): Promise<string> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  if (!artistId || !artwork.protected_storage_path.startsWith(`${artistId}/protected/`)) {
    throw new Error('This protected portfolio preview path is invalid.');
  }

  const { data, error } = await supabase.storage
    .from(ARTWORK_BUCKET)
    .createSignedUrl(artwork.protected_storage_path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function createProtectedPathSignedUrl(
  protectedStoragePath: string,
  expiresInSeconds = 60,
): Promise<string> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const pathSegments = protectedStoragePath.split('/');
  if (pathSegments.length < 3 || pathSegments[1] !== 'protected' || !pathSegments[0]) {
    throw new Error('This protected preview path is invalid.');
  }
  const { data, error } = await supabase.storage
    .from(ARTWORK_BUCKET)
    .createSignedUrl(protectedStoragePath, expiresInSeconds);
  if (error) {
    if (import.meta.env.DEV) console.error('ArtGuard admin protected preview signing failed:', { protectedStoragePath, error });
    throw error;
  }
  return data.signedUrl;
}

export async function deleteArtwork(artworkId: string, ownerId: string): Promise<void> {
  if (!supabase) throw new Error('Secure artwork storage is not configured.');
  const { data: artwork, error: recordError } = await supabase
    .from('artworks')
    .select('original_storage_path, protected_storage_path')
    .eq('id', artworkId)
    .eq('owner_id', ownerId)
    .single();
  if (recordError) throw recordError;

  const paths = [artwork.original_storage_path, artwork.protected_storage_path].filter(
    (path): path is string => Boolean(path),
  );
  const { error: storageError } = await supabase.storage.from(ARTWORK_BUCKET).remove(paths);
  if (storageError) {
    throw new Error(`The storage file could not be removed, so the artwork record was kept: ${storageError.message}`);
  }

  const { error: deleteError } = await supabase
    .from('artworks')
    .delete()
    .eq('id', artworkId)
    .eq('owner_id', ownerId);
  if (deleteError) {
    throw new Error(`The storage file was removed, but the artwork record could not be deleted: ${deleteError.message}`);
  }
}
