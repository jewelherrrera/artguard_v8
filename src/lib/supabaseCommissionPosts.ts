import { supabase } from './supabase';

export type CommissionPostStatus = 'OPEN' | 'CLOSED' | 'SELECTED' | 'CANCELLED';

export interface CommissionPost {
  id: string;
  client_id: string;
  owner_id: string;
  owner_role: 'client' | 'artist';
  title: string;
  description: string;
  budget_min: number | null;
  budget_max: number | null;
  currency: string | null;
  status: CommissionPostStatus;
  created_at: string;
  updated_at: string;
  owner_name?: string;
  owner_username?: string;
  owner_avatar_data_url?: string | null;
}

export interface CommissionPostInput {
  title: string;
  description: string;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string | null;
}

export interface OpenCommissionPost {
  id: string;
  client_id: string;
  owner_id: string;
  owner_role: 'client' | 'artist';
  title: string;
  description: string;
  budget_min: number | null;
  budget_max: number | null;
  currency: string | null;
  status: 'OPEN';
  created_at: string;
  updated_at: string;
  owner_name: string;
  owner_username: string;
  owner_avatar_data_url: string | null;
}

export type CommissionPostApplicationStatus = 'PENDING' | 'WITHDRAWN' | 'SELECTED' | 'REJECTED';

export interface MyCommissionPostApplication {
  id: string;
  commission_post_id: string;
  applicant_id: string;
  applicant_role: 'client' | 'artist';
  status: CommissionPostApplicationStatus;
  created_at: string;
}

export interface CommissionPostApplication {
  id: string;
  commission_post_id: string;
  artist_id: string;
  applicant_id: string;
  applicant_role: 'client' | 'artist';
  message: string;
  status: CommissionPostApplicationStatus;
  created_at: string;
  updated_at: string;
}

export interface OwnerCommissionPostApplication extends CommissionPostApplication {
  applicant_name: string;
  applicant_username: string;
  applicant_avatar_data_url: string | null;
}

export interface CommissionPostSelectionResult {
  id: string;
  order_ref: string;
  client_id: string;
  artist_id: string;
  title: string;
  description: string | null;
  status: 'REQUESTED';
  requested_at: string;
  service_id: string | null;
  amount: number | null;
  currency: string | null;
  public_post_id: string;
  created_at: string;
  updated_at: string;
}

export interface CommissionPostComment {
  id: string;
  commission_post_id: string;
  author_id: string;
  author_name: string;
  author_username: string;
  author_avatar_data_url: string | null;
  author_role: 'client' | 'artist';
  body: string;
  created_at: string;
  updated_at: string;
}

export interface CommissionPostEngagementSummary {
  commission_post_id: string;
  comment_count: number;
  application_count: number;
}

export async function listCommissionPostEngagementSummaries(
  commissionPostIds: string[],
): Promise<CommissionPostEngagementSummary[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const uniqueIds = [...new Set(commissionPostIds)];
  if (uniqueIds.length === 0) return [];
  const { data, error } = await supabase.rpc('list_commission_post_engagement_summaries', {
    p_commission_post_ids: uniqueIds,
  });
  if (error) throw error;
  return (data ?? []) as CommissionPostEngagementSummary[];
}

export async function listMyCommissionPosts(): Promise<CommissionPost[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('list_my_commission_posts');
  if (error) throw error;
  return ((data ?? []) as CommissionPost[]).map((post) => ({
    ...post,
    client_id: post.client_id ?? post.owner_id ?? post.owner_id,
    owner_id: post.owner_id ?? post.client_id,
    owner_role: post.owner_role ?? (post.owner_id == null || post.client_id === post.owner_id ? 'client' : 'artist'),
  }));
}

export async function listOpenCommissionPosts(): Promise<OpenCommissionPost[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('list_open_commission_posts');
  if (error) throw error;
  const rows = (data ?? []) as Array<Partial<OpenCommissionPost> & { owner_id?: string | null; client_id?: string | null; owner_role?: 'client' | 'artist' | null; applicant_role?: string | null; artist_id?: string | null; }>; 
  return rows.map((post) => {
    const ownerId = post.owner_id ?? post.client_id ?? '';
    const ownerRole = post.owner_role ?? (post.client_id === ownerId ? 'client' : 'artist');
    return {
      id: post.id ?? '',
      client_id: post.client_id ?? ownerId,
      owner_id: ownerId,
      owner_role: ownerRole,
      title: post.title ?? '',
      description: post.description ?? '',
      budget_min: post.budget_min ?? null,
      budget_max: post.budget_max ?? null,
      currency: post.currency ?? null,
      status: 'OPEN',
      created_at: post.created_at ?? new Date().toISOString(),
      updated_at: post.updated_at ?? post.created_at ?? new Date().toISOString(),
      owner_name: post.owner_name ?? '',
      owner_username: post.owner_username ?? '',
      owner_avatar_data_url: post.owner_avatar_data_url ?? null,
    };
  });
}

export async function listMyCommissionPostApplications(): Promise<MyCommissionPostApplication[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('list_my_commission_post_applications');
  if (error) throw error;
  return ((data ?? []) as Array<Partial<MyCommissionPostApplication> & { artist_id?: string | null; applicant_role?: 'client' | 'artist' | null }>).map((application) => ({
    id: application.id ?? '',
    commission_post_id: application.commission_post_id ?? '',
    applicant_id: application.applicant_id ?? application.artist_id ?? '',
    applicant_role: application.applicant_role ?? 'artist',
    status: application.status ?? 'PENDING',
    created_at: application.created_at ?? new Date().toISOString(),
  }));
}

export async function createCommissionPostApplication(
  commissionPostId: string,
  message: string,
): Promise<CommissionPostApplication> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_commission_post_application', {
    p_commission_post_id: commissionPostId,
    p_message: message.trim(),
  });
  if (error) throw error;
  if (!data) throw new Error('The application was not returned after submission.');
  return data as CommissionPostApplication;
}

export async function withdrawCommissionPostApplication(applicationId: string): Promise<CommissionPostApplication> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('withdraw_commission_post_application', {
    p_application_id: applicationId,
  });
  if (error) throw error;
  if (!data) throw new Error('The application was not returned after withdrawal.');
  return data as CommissionPostApplication;
}

export async function listPostApplicationsForOwner(
  commissionPostId: string,
): Promise<OwnerCommissionPostApplication[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('list_post_applications_for_owner', {
    p_commission_post_id: commissionPostId,
  });
  if (error) throw error;
  return ((data ?? []) as Array<Omit<OwnerCommissionPostApplication, 'id'> & { application_id: string }>)
    .map(({ application_id, ...application }) => ({ ...application, id: application_id }));
}

export async function selectCommissionPostApplicant(
  commissionPostId: string,
  applicationId: string,
  amount: number,
  currency: string,
): Promise<CommissionPostSelectionResult> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('select_commission_post_applicant', {
    p_commission_post_id: commissionPostId,
    p_application_id: applicationId,
    p_amount: amount,
    p_currency: currency,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('The commission was not returned after selecting the applicant.');
  return row as CommissionPostSelectionResult;
}

export async function listCommissionPostComments(postId: string): Promise<CommissionPostComment[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('list_commission_post_comments', {
    p_commission_post_id: postId,
  });
  if (error) throw error;
  return (data ?? []) as CommissionPostComment[];
}

export async function createCommissionPostComment(
  postId: string,
  body: string,
): Promise<CommissionPostComment> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_commission_post_comment', {
    p_commission_post_id: postId,
    p_body: body,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('The comment was not returned after creation.');
  return row as CommissionPostComment;
}

export async function deleteCommissionPostComment(commentId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('delete_commission_post_comment', {
    p_comment_id: commentId,
  });
  if (error) throw error;
  if (!data) throw new Error('The comment was not returned after deletion.');
}

export async function deleteCommissionPost(commissionPostId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('delete_commission_post', {
    p_commission_post_id: commissionPostId,
  });
  if (error) throw error;
  if (typeof data !== 'string' || data !== commissionPostId) {
    throw new Error('The public request was not returned after deletion.');
  }
  return data;
}

export async function rejectCommissionPostApplication(applicationId: string): Promise<CommissionPostApplication> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('reject_commission_post_application', {
    p_application_id: applicationId,
  });
  if (error) throw error;
  if (!data) throw new Error('The application was not returned after rejection.');
  return data as CommissionPostApplication;
}

export async function createCommissionPost(input: CommissionPostInput): Promise<CommissionPost> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_commission_post', {
    p_title: input.title,
    p_description: input.description,
    p_budget_min: input.budgetMin,
    p_budget_max: input.budgetMax,
    p_currency: input.currency,
  });
  if (error) throw error;
  if (!data) throw new Error('The public request was not returned after creation.');
  return data as CommissionPost;
}

export async function updateCommissionPost(
  commissionPostId: string,
  input: CommissionPostInput,
): Promise<CommissionPost> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('update_commission_post', {
    p_commission_post_id: commissionPostId,
    p_title: input.title,
    p_description: input.description,
    p_budget_min: input.budgetMin,
    p_budget_max: input.budgetMax,
    p_currency: input.currency,
  });
  if (error) throw error;
  if (!data) throw new Error('The public request was not returned after updating.');
  return data as CommissionPost;
}

export async function closeCommissionPost(commissionPostId: string): Promise<CommissionPost> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('close_commission_post', {
    p_commission_post_id: commissionPostId,
  });
  if (error) throw error;
  if (!data) throw new Error('The public request was not returned after closing.');
  return data as CommissionPost;
}
