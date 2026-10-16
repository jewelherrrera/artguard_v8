import { supabase } from './supabase';

export type CommissionPaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'VOIDED';

export interface CommissionPayment {
  id: string;
  commission_id: string;
  payer_id: string;
  payee_id: string;
  amount: number;
  currency: string;
  status: CommissionPaymentStatus;
  provider: string | null;
  provider_reference: string | null;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  refunded_amount: number | null;
  created_by: string;
}

function readPayment(data: unknown): CommissionPayment {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('Payment information was not returned by Supabase.');
  return row as CommissionPayment;
}

export async function getCommissionPayment(commissionId: string): Promise<CommissionPayment | null> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('commission_payments')
    .select('*')
    .eq('commission_id', commissionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as CommissionPayment | null;
}

export async function listMyPaidCommissionPayments(
  userId: string,
  role: 'artist' | 'client',
): Promise<CommissionPayment[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const partyColumn = role === 'artist' ? 'payee_id' : 'payer_id';
  const { data, error } = await supabase
    .from('commission_payments')
    .select('*')
    .eq(partyColumn, userId)
    .eq('status', 'PAID')
    .order('paid_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CommissionPayment[];
}

export async function createCommissionPayment(commissionId: string): Promise<CommissionPayment> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_commission_payment', {
    p_commission_id: commissionId,
  });
  if (error) throw error;
  return readPayment(data);
}

export async function simulateCommissionPaymentSuccess(paymentId: string): Promise<CommissionPayment> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('simulate_commission_payment_success', {
    p_payment_id: paymentId,
  });
  if (error) throw error;
  return readPayment(data);
}

export async function simulateCommissionPaymentFailure(paymentId: string): Promise<CommissionPayment> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('simulate_commission_payment_failure', {
    p_payment_id: paymentId,
  });
  if (error) throw error;
  return readPayment(data);
}

export async function simulateCommissionPaymentRefund(paymentId: string): Promise<CommissionPayment> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('simulate_commission_payment_refund', {
    p_payment_id: paymentId,
  });
  if (error) throw error;
  return readPayment(data);
}