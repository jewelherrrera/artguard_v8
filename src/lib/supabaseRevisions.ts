import { supabase } from './supabase';
import type { PublicProfile } from './supabaseData';

export type RevisionStatus = 'OPEN' | 'IN_PROGRESS' | 'SUBMITTED' | 'RESOLVED';
export type CommissionStatus = 'REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'IN_PROGRESS' | 'REVISION_REQUESTED' | 'COMPLETED' | 'CANCELLED';

export interface CommissionLink {
  id: string;
  order_ref: string;
  client_id: string;
  artist_id: string;
  title: string;
  description: string | null;
  status: CommissionStatus;
  requested_at: string;
  accepted_at: string | null;
  started_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  service_id: string | null;
  public_post_id: string | null;
  service_name_snapshot: string | null;
  amount: number | null;
  currency: string | null;
  turnaround_days_snapshot: number | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export function getCommissionDueAt(commission: Pick<CommissionLink, 'started_at' | 'turnaround_days_snapshot'>): string | null {
  const startedAt = commission.started_at ? Date.parse(commission.started_at) : Number.NaN;
  const turnaroundDays = commission.turnaround_days_snapshot;
  if (!Number.isFinite(startedAt) || !Number.isInteger(turnaroundDays) || turnaroundDays === null || turnaroundDays <= 0) {
    return null;
  }

  // Turnaround days are elapsed 24-hour periods, matching existing duration calculations.
  const dueAt = new Date(startedAt + turnaroundDays * 86_400_000);
  return Number.isNaN(dueAt.getTime()) ? null : dueAt.toISOString();
}

export function isCommissionOverdue(commission: CommissionLink, now = new Date()): boolean {
  if (commission.status !== 'IN_PROGRESS' && commission.status !== 'REVISION_REQUESTED') return false;
  const dueAt = getCommissionDueAt(commission);
  return dueAt !== null && now.getTime() > Date.parse(dueAt);
}

/** A commission ready to render in a list — includes the other party's
 * real profile info so the UI doesn't need a second round trip per row. */
export interface MyCommission extends CommissionLink {
  counterparty: Pick<PublicProfile, 'id' | 'name' | 'username' | 'avatar_data_url'> | null;
  /** True when the current viewer is this commission's client. */
  isClient: boolean;
}

export interface RevisionRequest {
  id: string;
  commission_id: string;
  deliverable_id: string | null;
  milestone_id: string | null;
  client_id: string;
  artist_id: string;
  description: string;
  status: RevisionStatus;
  response_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommissionProgressUpdate {
  id: string;
  commission_id: string;
  progress_percent: number;
  note: string;
  created_at: string;
}

/**
 * Looks up the real commission link for a given demo order, if one has
 * already been created. RLS means this only ever returns a row when the
 * current user is one of its two real parties.
 */
export async function getCommissionByOrderRef(orderRef: string): Promise<CommissionLink | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('commissions')
    .select('*')
    .eq('order_ref', orderRef)
    .maybeSingle();
  if (error) throw error;
  return data as CommissionLink | null;
}

/** Looks up a real commission directly by its own id (not a demo order_ref). */
export async function getCommissionById(commissionId: string): Promise<CommissionLink | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('commissions')
    .select('*')
    .eq('id', commissionId)
    .maybeSingle();
  if (error) throw error;
  return data as CommissionLink | null;
}

/**
 * Every real commission the current user is a party to (as client or
 * artist), newest first, with the other party's profile attached.
 * RLS (`commission parties can read`) already restricts this to rows
 * where auth.uid() is client_id or artist_id — the .or() filter below
 * just avoids fetching rows we'd have to discard client-side.
 */
export async function listMyCommissions(userId: string): Promise<MyCommission[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('commissions')
    .select('*')
    .or(`client_id.eq.${userId},artist_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as CommissionLink[];
  if (rows.length === 0) return [];

  const otherIds = Array.from(
    new Set(rows.map((row) => (row.client_id === userId ? row.artist_id : row.client_id))),
  );

  const { data: profileRows, error: profilesError } = await supabase
    .from('profiles')
    .select('id,name,username,avatar_data_url')
    .in('id', otherIds);
  if (profilesError) throw profilesError;

  const profileById = new Map<string, PublicProfile>();
  for (const profile of (profileRows ?? []) as PublicProfile[]) {
    profileById.set(profile.id, profile);
  }

  return rows.map((row) => {
    const isClient = row.client_id === userId;
    const otherId = isClient ? row.artist_id : row.client_id;
    return {
      ...row,
      isClient,
      counterparty: profileById.get(otherId) ?? null,
    };
  });
}

/**
 * One-time real-account link for a commission — see
 * get_or_create_commission in supabase/revision-requests.sql (and its
 * Batch 1A update in supabase/real-commissions.sql).
 *
 *  - Pass an orderRef to link a legacy demo order (e.g. "AG-2291") to
 *    two real accounts — resolves to the same commission every time.
 *  - Omit orderRef to start a brand-new real commission with no demo
 *    order behind it — the database generates a unique reference.
 *
 * Either way, the caller becomes one party automatically via auth.uid()
 * inside the function; counterpartyId is the other real account.
 */
export async function getOrCreateCommission(
  counterpartyId: string,
  title: string,
  orderRef?: string,
): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('get_or_create_commission', {
    p_order_ref: orderRef ?? null,
    p_counterparty_id: counterpartyId,
    p_title: title,
  });
  if (error) throw error;
  return String(data);
}

export async function createCommissionRequest(
  artistId: string,
  title: string,
  description: string,
): Promise<{ commissionId: string; created: boolean }> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_commission_request', {
    p_artist_id: artistId,
    p_title: title,
    p_description: description,
  });
  if (error) throw error;
  const result = data as { commission_id?: string; created?: boolean };
  if (!result.commission_id) throw new Error('The commission request did not return an id.');
  return { commissionId: result.commission_id, created: result.created === true };
}

export async function createServiceCommissionRequest(
  serviceId: string,
  title: string,
  description: string,
): Promise<{ commissionId: string; created: boolean }> {
  if (!supabase) throw new Error('Supabase is not configured.');
  let currentUserId: string | null = null;
  let currentRole: string | null = null;
  if (import.meta.env.DEV) {
    const { data: userData } = await supabase.auth.getUser();
    currentUserId = userData.user?.id ?? null;
    if (currentUserId) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', currentUserId).maybeSingle();
      currentRole = profile?.role ?? null;
    }
    console.debug('[commission request] RPC input', {
      serviceId,
      currentUserId,
      currentRole,
      titleLength: title.length,
      descriptionLength: description.length,
    });
  }
  const { data, error } = await supabase.rpc('create_service_commission_request', {
    p_service_id: serviceId,
    p_title: title,
    p_description: description,
  });
  if (error) {
    if (import.meta.env.DEV) {
      console.debug('[commission request] RPC error', {
        serviceId,
        currentUserId,
        currentRole,
        titleLength: title.length,
        descriptionLength: description.length,
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
    throw error;
  }
  const result = data as { commission_id?: string; created?: boolean };
  if (!result.commission_id) throw new Error('The service commission request did not return an id.');
  return { commissionId: result.commission_id, created: result.created === true };
}

export async function acceptCommissionRequest(commissionId: string): Promise<CommissionLink> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('accept_commission_request', { p_commission_id: commissionId });
  if (error) throw error;
  return data as CommissionLink;
}

export async function rejectCommissionRequest(commissionId: string, reason: string): Promise<CommissionLink> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('reject_commission_request', {
    p_commission_id: commissionId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as CommissionLink;
}

export async function startCommission(commissionId: string): Promise<CommissionLink> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('start_commission', { p_commission_id: commissionId });
  if (error) throw error;
  return data as CommissionLink;
}

export async function cancelCommission(commissionId: string, reason: string): Promise<CommissionLink> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('cancel_commission', {
    p_commission_id: commissionId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as CommissionLink;
}

export interface CompletedCommissionResult {
  commission_id: string;
  status: 'COMPLETED';
  completed_at: string;
}

export async function completeCommission(commissionId: string): Promise<CompletedCommissionResult> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('complete_commission', {
    p_commission_id: commissionId,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error('The completion result was empty.');
  return result as CompletedCommissionResult;
}

export async function createCommissionProgress(
  commissionId: string,
  progressPercent: number,
  note: string,
): Promise<CommissionProgressUpdate> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_commission_progress', {
    p_commission_id: commissionId,
    p_progress_percent: progressPercent,
    p_note: note,
  });
  if (error) throw error;
  return data as CommissionProgressUpdate;
}

export async function listCommissionProgress(commissionId: string): Promise<CommissionProgressUpdate[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_commission_progress', { p_commission_id: commissionId });
  if (error) throw error;
  return (data ?? []) as CommissionProgressUpdate[];
}

export async function listRevisionRequests(commissionId: string): Promise<RevisionRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('revision_requests')
    .select('*')
    .eq('commission_id', commissionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RevisionRequest[];
}

export async function createRevisionRequest(commissionId: string, description: string): Promise<RevisionRequest> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_revision_request', {
    p_commission_id: commissionId,
    p_description: description,
  });
  if (error) throw error;
  return data as RevisionRequest;
}

export async function createDeliverableRevisionRequest(
  commissionId: string,
  deliverableId: string,
  description: string,
): Promise<RevisionRequest> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_revision_request', {
    p_commission_id: commissionId,
    p_deliverable_id: deliverableId,
    p_description: description,
  });
  if (error) throw error;
  return data as RevisionRequest;
}

export async function setRevisionStatus(
  revisionId: string,
  status: Exclude<RevisionStatus, 'OPEN'>,
  responseText?: string,
): Promise<RevisionRequest> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('set_revision_status', {
    p_revision_id: revisionId,
    p_status: status,
    p_response_text: responseText ?? null,
  });
  if (error) throw error;
  return data as RevisionRequest;
}
