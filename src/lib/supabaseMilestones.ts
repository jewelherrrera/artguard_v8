import { supabase } from './supabase';

export type CommissionMilestoneStatus = 'PENDING' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';

export interface CommissionMilestone {
  id: string;
  commission_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  status: CommissionMilestoneStatus;
  started_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export async function listCommissionMilestones(commissionId: string): Promise<CommissionMilestone[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_commission_milestones', {
    p_commission_id: commissionId,
  });
  if (error) throw error;
  return (data ?? []) as CommissionMilestone[];
}

export async function createDefaultCommissionMilestones(commissionId: string): Promise<CommissionMilestone[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_default_commission_milestones', {
    p_commission_id: commissionId,
  });
  if (error) throw error;
  return (data ?? []) as CommissionMilestone[];
}

export async function startCommissionMilestone(milestoneId: string): Promise<CommissionMilestone> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('start_commission_milestone', {
    p_milestone_id: milestoneId,
  });
  if (error) throw error;
  return data as CommissionMilestone;
}

export async function submitCommissionMilestone(milestoneId: string, note: string): Promise<CommissionMilestone> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('submit_commission_milestone', {
    p_milestone_id: milestoneId,
    p_note: note,
  });
  if (error) throw error;
  return data as CommissionMilestone;
}

export async function approveCommissionMilestone(milestoneId: string): Promise<CommissionMilestone> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('approve_commission_milestone', {
    p_milestone_id: milestoneId,
  });
  if (error) {
    if (import.meta.env.DEV) {
      console.error('ArtGuard: approve_commission_milestone failed', {
        milestoneId,
        errorMessage: error.message,
        errorCode: error.code,
      });
    }
    throw error;
  }
  return data as CommissionMilestone;
}
