import { supabase } from './supabase';
import {
  ARTWORK_BUCKET,
  createProtectedDerivativeFromSignedUrl,
  validateArtworkFile,
  type ArtworkRecord,
} from './supabaseArtworks';

export type CommissionDeliverableStatus = 'PROCESSING' | 'SUBMITTED' | 'APPROVED' | 'FAILED' | 'HIDDEN';

export interface CommissionDeliverable {
  id: string;
  commission_id: string;
  title: string;
  description: string | null;
  protected_storage_path: string | null;
  status: CommissionDeliverableStatus;
  submitted_at: string | null;
  approved_at?: string | null;
  created_at: string;
}

function safeFilename(filename: string): string {
  const base = filename.replace(/\.[^/.]+$/, '');
  const cleaned = base.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return cleaned || 'deliverable';
}

function randomId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function uploadCommissionDeliverable(
  artistId: string,
  commissionId: string,
  title: string,
  description: string,
  file: File,
): Promise<CommissionDeliverable> {
  if (!supabase || !artistId) throw new Error('Supabase is not configured.');
  const validation = validateArtworkFile(file);
  if (validation) throw new Error(validation);

  const originalPath = `${artistId}/commissions/${commissionId}/original/${randomId()}-${safeFilename(file.name)}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
  const protectedPath = `${artistId}/commissions/${commissionId}/protected/${randomId()}-${safeFilename(file.name)}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
  const { error: uploadError } = await supabase.storage.from(ARTWORK_BUCKET).upload(originalPath, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  let deliverable: (CommissionDeliverable & { original_storage_path?: string }) | undefined;
  try {
    const { data, error } = await supabase.rpc('create_commission_deliverable', {
      p_commission_id: commissionId,
      p_title: title,
      p_description: description || null,
      p_original_storage_path: originalPath,
    });
    if (error) throw error;
    deliverable = data as CommissionDeliverable & { original_storage_path?: string };
    const { data: signed, error: signedError } = await supabase.storage.from(ARTWORK_BUCKET).createSignedUrl(originalPath, 120);
    if (signedError) throw signedError;
    await createProtectedDerivativeFromSignedUrl(signed.signedUrl, file.type as ArtworkRecord['mime_type'], protectedPath, 'standard');
    const { data: submitted, error: submitError } = await supabase.rpc('submit_commission_deliverable', {
      p_deliverable_id: deliverable.id,
      p_protected_storage_path: protectedPath,
    });
    if (submitError) throw submitError;
    return submitted as CommissionDeliverable;
  } catch (error) {
    await supabase.storage.from(ARTWORK_BUCKET).remove([originalPath, protectedPath]);
    if (deliverable?.id) await supabase.rpc('fail_commission_deliverable', { p_deliverable_id: deliverable.id });
    throw error instanceof Error ? error : new Error('Deliverable processing failed.');
  }
}

export async function listCommissionDeliverables(commissionId: string): Promise<CommissionDeliverable[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_commission_deliverables', { p_commission_id: commissionId });
  if (error) throw error;
  return (data ?? []) as CommissionDeliverable[];
}

export async function createCommissionDeliverableSignedUrl(
  commissionId: string,
  deliverable: CommissionDeliverable,
  expiresInSeconds = 60,
): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!['SUBMITTED', 'APPROVED'].includes(deliverable.status) || !deliverable.protected_storage_path?.includes(`/commissions/${commissionId}/protected/`)) {
    throw new Error('This deliverable preview is not available.');
  }
  const { data, error } = await supabase.storage.from(ARTWORK_BUCKET).createSignedUrl(deliverable.protected_storage_path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function approveCommissionDeliverable(deliverableId: string): Promise<CommissionDeliverable> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('approve_commission_deliverable', { p_deliverable_id: deliverableId });
  if (error) throw error;
  return data as CommissionDeliverable;
}
