import { useEffect, useState } from 'react';
import { useRef } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import './CommissionWorkspacePage.css';
import { IconButton } from '../components/ui/IconButton';
import { OptionsMenu } from '../components/ui/OptionsMenu';
import { ArtTile } from '../components/ui/ArtTile';
import { ProgressBar } from '../components/ui/ProgressBar';
import { RevisionRequests } from '../components/commission/RevisionRequests';
import { Icon } from '../assets/icons';
import { ORDERS } from '../data/mockData';
import { useMockToast } from '../components/ui/MockToast';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { getPublicProfile, initialsFor, type PublicProfile } from '../lib/supabaseData';
import { cancelCommission, completeCommission, createCommissionProgress, getCommissionById, getCommissionDueAt, isCommissionOverdue, listCommissionProgress, listRevisionRequests, startCommission, type CommissionLink, type CommissionProgressUpdate, type RevisionRequest } from '../lib/supabaseRevisions';
import { listArtistReviews, submitArtistReview, updateArtistReview, type ArtistReview, type SubmittedArtistReview } from '../lib/supabaseReviews';
import { approveCommissionDeliverable, createCommissionDeliverableSignedUrl, listCommissionDeliverables, uploadCommissionDeliverable, type CommissionDeliverable } from '../lib/supabaseDeliverables';
import { approveCommissionMilestone, createDefaultCommissionMilestones, listCommissionMilestones, startCommissionMilestone, submitCommissionMilestone, type CommissionMilestone } from '../lib/supabaseMilestones';
import { ProtectedArtworkDisplay } from '../components/ui/ProtectedArtworkDisplay';
import { createCommissionPayment, getCommissionPayment, simulateCommissionPaymentFailure, simulateCommissionPaymentRefund, simulateCommissionPaymentSuccess, type CommissionPayment } from '../lib/supabasePayments';

const STATUS_DOT_STYLE = {
  approved: { background: 'var(--ag-success)' },
  'in-progress': { background: 'var(--ag-accent)', boxShadow: '0 0 0 4px rgba(232,178,61,0.25)' },
  pending: { background: 'var(--ag-surface-3)', border: '2px solid var(--ag-border)' },
} as const;

const COMMISSION_STATUS_LABELS: Record<CommissionLink['status'], string> = {
  REQUESTED: 'Requested',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  IN_PROGRESS: 'In Progress',
  REVISION_REQUESTED: 'Revision Requested',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

function formatCommissionDate(value: string | null | undefined): string | null {
  return value
    ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;
}

function canEditArtistReview(review: Pick<SubmittedArtistReview, 'created_at' | 'edited_at'>, now = Date.now()): boolean {
  const createdAt = Date.parse(review.created_at);
  return review.edited_at === null
    && Number.isFinite(createdAt)
    && createdAt <= now
    && now <= createdAt + 7 * 24 * 60 * 60 * 1000;
}

function hasCommissionPaymentPrice(commission: CommissionLink): boolean {
  return commission.amount !== null
    && commission.amount !== undefined
    && Number.isFinite(commission.amount)
    && commission.amount > 0
    && /^[A-Z]{3}$/.test(commission.currency ?? '');
}

export function CommissionWorkspacePage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { toast, showToast } = useMockToast();
  const { user } = useAuth();
  const { startConversation } = useChat();

  // A route param that matches one of the hardcoded demo Orders always
  // renders the existing mock workspace below, unchanged. Anything else
  // is treated as a real public.commissions id (see the real-commission
  // branch further down).
  const mockOrder = ORDERS.find((o) => o.id === orderId);

  const [realCommission, setRealCommission] = useState<CommissionLink | null>(null);
  const [realCounterparty, setRealCounterparty] = useState<PublicProfile | null>(null);
  const [realLoading, setRealLoading] = useState(true);
  const [realError, setRealError] = useState(false);
  const [commissionPayment, setCommissionPayment] = useState<CommissionPayment | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentStatusCommissionId, setPaymentStatusCommissionId] = useState<string | null>(null);
  const [paymentActionLoading, setPaymentActionLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | undefined>();
  const paymentActionInFlight = useRef(false);
  const [progressUpdates, setProgressUpdates] = useState<CommissionProgressUpdate[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState<string | undefined>();
  const [startingCommission, setStartingCommission] = useState(false);
  const [postingProgress, setPostingProgress] = useState(false);
  const [progressPercent, setProgressPercent] = useState('0');
  const [progressNote, setProgressNote] = useState('');
  const [deliverables, setDeliverables] = useState<CommissionDeliverable[]>([]);
  const [deliverableUrls, setDeliverableUrls] = useState<Record<string, string>>({});
  const [deliverablesLoading, setDeliverablesLoading] = useState(false);
  const [deliverablesError, setDeliverablesError] = useState<string | undefined>();
  const [uploadingDeliverable, setUploadingDeliverable] = useState(false);
  const [deliverableTitle, setDeliverableTitle] = useState('');
  const [deliverableDescription, setDeliverableDescription] = useState('');
  const [reviewDeliverableId, setReviewDeliverableId] = useState<string | undefined>();
  const [revisionSectionVisible, setRevisionSectionVisible] = useState(false);
  const [approvingDeliverableId, setApprovingDeliverableId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<CommissionMilestone[]>([]);
  const [milestonesLoading, setMilestonesLoading] = useState(false);
  const [milestonesError, setMilestonesError] = useState<string | undefined>();
  const [milestoneActionId, setMilestoneActionId] = useState<string | null>(null);
  const [milestoneNoteId, setMilestoneNoteId] = useState<string | null>(null);
  const [milestoneNote, setMilestoneNote] = useState('');
  const [cancellingCommission, setCancellingCommission] = useState(false);
  const [cancellationDialogOpen, setCancellationDialogOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [refundError, setRefundError] = useState<string | undefined>();
  const [revisionRequests, setRevisionRequests] = useState<RevisionRequest[]>([]);
  const [revisionRequestsLoading, setRevisionRequestsLoading] = useState(false);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionDialogOpen, setCompletionDialogOpen] = useState(false);
  const [completionError, setCompletionError] = useState<string | undefined>();
  const [reviewCheckState, setReviewCheckState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [reviewCheckRetry, setReviewCheckRetry] = useState(0);
  const [commissionReview, setCommissionReview] = useState<ArtistReview | SubmittedArtistReview | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewEditing, setReviewEditing] = useState(false);
  const [reviewRating, setReviewRating] = useState<number | null>(null);
  const [reviewText, setReviewText] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitError, setReviewSubmitError] = useState<string | undefined>();
  const deliverableFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mockOrder || !orderId || !user) {
      setRealLoading(false);
      return;
    }
    let active = true;
    setRealLoading(true);
    setRealError(false);
    getCommissionById(orderId)
      .then(async (found) => {
        if (!active) return;
        if (!found) {
          setRealError(true);
          return;
        }
        setRealCommission(found);
        const otherId = found.client_id === user.id ? found.artist_id : found.client_id;
        const profile = await getPublicProfile(otherId);
        if (active) setRealCounterparty(profile);
      })
      .catch(() => {
        if (active) setRealError(true);
      })
      .finally(() => {
        if (active) setRealLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId, mockOrder, user]);

  useEffect(() => {
    if (mockOrder || !realCommission || !user) {
      setCommissionPayment(null);
      setPaymentError(undefined);
      setPaymentLoading(false);
      return;
    }

    let active = true;
    setCommissionPayment(null);
    setPaymentStatusCommissionId(null);
    setPaymentLoading(true);
    setPaymentError(undefined);
    void getCommissionPayment(realCommission.id)
      .then((payment) => {
        if (active) {
          setCommissionPayment(payment);
          setPaymentStatusCommissionId(realCommission.id);
        }
      })
      .catch(() => {
        if (active) setPaymentError('Could not load payment status. Please try again.');
      })
      .finally(() => {
        if (active) setPaymentLoading(false);
      });
    return () => { active = false; };
  }, [mockOrder, realCommission?.id, user?.id]);

  useEffect(() => {
    if (mockOrder || !realCommission || realCommission.status !== 'COMPLETED' || user?.role !== 'client' || user.id !== realCommission.client_id) {
      setReviewCheckState('idle');
      setCommissionReview(null);
      return;
    }

    let active = true;
    setReviewCheckState('loading');
    setCommissionReview(null);
    void listArtistReviews(realCommission.artist_id)
      .then((reviews) => {
        if (!active) return;
        setCommissionReview(reviews.find((review) => review.commission_id === realCommission.id) ?? null);
        setReviewCheckState('ready');
      })
      .catch(() => {
        if (active) setReviewCheckState('error');
      });
    return () => {
      active = false;
    };
  }, [mockOrder, realCommission, user?.id, user?.role, reviewCheckRetry]);

  useEffect(() => {
    if (!realCommission || !['IN_PROGRESS', 'REVISION_REQUESTED', 'ACCEPTED', 'COMPLETED'].includes(realCommission.status)) {
      setProgressUpdates([]);
      setProgressError(undefined);
      setProgressLoading(false);
      return;
    }
    let active = true;
    setProgressLoading(true);
    setProgressError(undefined);
    void listCommissionProgress(realCommission.id)
      .then((updates) => {
        if (active) setProgressUpdates(updates);
      })
      .catch((error) => {
        if (active) setProgressError(error instanceof Error ? error.message : 'Could not load commission progress.');
      })
      .finally(() => {
        if (active) setProgressLoading(false);
      });
    return () => {
      active = false;
    };
  }, [realCommission]);

  useEffect(() => {
    if (!realCommission || !['ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED', 'COMPLETED'].includes(realCommission.status)) {
      setMilestones([]);
      setMilestonesError(undefined);
      setMilestonesLoading(false);
      return;
    }
    let active = true;
    setMilestonesLoading(true);
    setMilestonesError(undefined);
    void listCommissionMilestones(realCommission.id)
      .then(async (rows) => {
        if (!active) return;
        if (rows.length === 0 && user?.id === realCommission.artist_id && realCommission.status === 'ACCEPTED') {
          const created = await createDefaultCommissionMilestones(realCommission.id);
          if (active) setMilestones(created);
        } else if (active) {
          setMilestones(rows);
        }
      })
      .catch((error) => {
        if (active) setMilestonesError(error instanceof Error ? error.message : 'Could not load milestones.');
      })
      .finally(() => {
        if (active) setMilestonesLoading(false);
      });
    return () => { active = false; };
  }, [realCommission, user]);

  useEffect(() => {
    if (!realCommission || !['IN_PROGRESS', 'REVISION_REQUESTED', 'ACCEPTED', 'COMPLETED'].includes(realCommission.status)) {
      setDeliverables([]);
      setDeliverableUrls({});
      setDeliverablesError(undefined);
      setDeliverablesLoading(false);
      return;
    }
    let active = true;
    setDeliverablesLoading(true);
    setDeliverablesError(undefined);
    void listCommissionDeliverables(realCommission.id)
      .then(async (rows) => {
        if (!active) return;
        setDeliverables(rows);
        const entries = await Promise.all(rows.filter((row) => row.status === 'SUBMITTED').map(async (row) => {
          try {
            return [row.id, await createCommissionDeliverableSignedUrl(realCommission.id, row)] as const;
          } catch {
            return null;
          }
        }));
        if (active) setDeliverableUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
      })
      .catch((error) => {
        if (active) setDeliverablesError(error instanceof Error ? error.message : 'Could not load deliverables.');
      })
      .finally(() => {
        if (active) setDeliverablesLoading(false);
      });
    return () => { active = false; };
  }, [realCommission]);

  useEffect(() => {
    if (!realCommission || !['IN_PROGRESS', 'REVISION_REQUESTED', 'COMPLETED'].includes(realCommission.status)) {
      setRevisionRequests([]);
      setRevisionRequestsLoading(false);
      return;
    }
    let active = true;
    setRevisionRequestsLoading(true);
    void listRevisionRequests(realCommission.id)
      .then((rows) => { if (active) setRevisionRequests(rows); })
      .catch(() => { if (active) setRevisionRequests([]); })
      .finally(() => { if (active) setRevisionRequestsLoading(false); });
    return () => { active = false; };
  }, [realCommission]);

  const handleStartCommission = async () => {
    if (!realCommission || !user || user.id !== realCommission.artist_id || startingCommission) return;
    if (realCommission.service_id !== null || realCommission.public_post_id !== null) {
      const paymentIsKnown = paymentStatusCommissionId === realCommission.id && !paymentLoading && !paymentError;
      const matchingPaymentIsPaid = paymentIsKnown
        && commissionPayment?.commission_id === realCommission.id
        && commissionPayment.payer_id === realCommission.client_id
        && commissionPayment.payee_id === realCommission.artist_id
        && commissionPayment.amount === realCommission.amount
        && commissionPayment.currency === realCommission.currency
        && commissionPayment.status === 'PAID';
      if (!hasCommissionPaymentPrice(realCommission) || !matchingPaymentIsPaid) return;
    }
    setStartingCommission(true);
    try {
      const updated = await startCommission(realCommission.id);
      setRealCommission(updated);
      const createdMilestones = await createDefaultCommissionMilestones(updated.id);
      setMilestones(createdMilestones);
      showToast('Commission started');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      showToast(message.includes('PAYMENT_REQUIRED_BEFORE_START')
        ? 'Payment required before starting this commission.'
        : message.includes('COMMISSION_PRICE_UNAVAILABLE')
          ? 'Commission price unavailable. Contact support.'
          : message || 'Could not start this commission.');
    } finally {
      setStartingCommission(false);
    }
  };

  const handleStartMilestone = async (milestoneId: string) => {
    if (!realCommission || !user || user.id !== realCommission.artist_id || milestoneActionId) return;
    setMilestoneActionId(milestoneId);
    try {
      const updated = await startCommissionMilestone(milestoneId);
      setMilestones((current) => current.map((milestone) => milestone.id === updated.id ? updated : milestone));
      showToast('Milestone started');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start this milestone.');
    } finally {
      setMilestoneActionId(null);
    }
  };

  const openCancellationDialog = () => {
    if (!realCommission || !user || cancellingCommission) return;
    const allowedForClient = ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED'].includes(realCommission.status);
    const allowedForArtist = ['ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED'].includes(realCommission.status);
    const allowed = realCommission.client_id === user.id ? allowedForClient : realCommission.artist_id === user.id ? allowedForArtist : false;
    if (!allowed) return;
    if (window.matchMedia('(min-width: 1024px)').matches) {
      if (!window.confirm('Cancel this commission? This cannot be undone.')) return;
      const reason = window.prompt('Why are you cancelling this commission?')?.trim() ?? '';
      if (!reason) {
        showToast('A cancellation reason is required.');
        return;
      }
      void handleCancelCommission(reason);
      return;
    }
    setCancellationReason('');
    setCancellationDialogOpen(true);
  };

  const handleCancelCommission = async (providedReason?: string) => {
    if (!realCommission || !user || cancellingCommission) return;
    const reason = (providedReason ?? cancellationReason).trim();
    if (!reason) {
      showToast('A cancellation reason is required.');
      return;
    }
    setCancellingCommission(true);
    try {
      const updated = await cancelCommission(realCommission.id, reason);
      setRealCommission(updated);
      setCancellationDialogOpen(false);
      setCancellationReason('');
      showToast('Commission cancelled');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not cancel this commission.');
    } finally {
      setCancellingCommission(false);
    }
  };

  const handleSubmitMilestone = async (milestoneId: string) => {
    if (!realCommission || !user || user.id !== realCommission.artist_id || milestoneActionId) return;
    setMilestoneActionId(milestoneId);
    try {
      const updated = await submitCommissionMilestone(milestoneId, milestoneNote.trim());
      setMilestones((current) => current.map((milestone) => milestone.id === updated.id ? updated : milestone));
      setMilestoneNoteId(null);
      setMilestoneNote('');
      showToast('Milestone submitted');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not submit this milestone.');
    } finally {
      setMilestoneActionId(null);
    }
  };

  const handleApproveMilestone = async (milestoneId: string) => {
    if (!realCommission || !user || user.id !== realCommission.client_id || milestoneActionId) return;
    if (!window.confirm('Approve this milestone?')) return;
    setMilestoneActionId(milestoneId);
    try {
      const updated = await approveCommissionMilestone(milestoneId);
      setMilestones((current) => current.map((milestone) => milestone.id === updated.id ? updated : milestone));
      showToast('Milestone approved');
    } catch (error) {
      if (import.meta.env.DEV) {
        const milestone = milestones.find((item) => item.id === milestoneId);
        console.error('ArtGuard: approval context', {
          milestoneId,
          commissionId: realCommission.id,
          currentUserId: user.id,
          currentRole: user.role,
          milestoneStatus: milestone?.status,
          commissionStatus: realCommission.status,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorCode: typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined,
        });
      }
      showToast(error instanceof Error ? error.message : 'Could not approve this milestone.');
    } finally {
      setMilestoneActionId(null);
    }
  };

  const handleCompleteCommission = async () => {
    if (!realCommission || completionLoading) return;
    setCompletionLoading(true);
    setCompletionError(undefined);
    try {
      const result = await completeCommission(realCommission.id);
      setRealCommission((current) => current ? { ...current, status: result.status, completed_at: result.completed_at, completed_by: user?.id ?? current.completed_by } : current);
      setCompletionDialogOpen(false);
      showToast('Commission completed');
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      const friendlyMessage = message.includes('milestone')
        ? 'All milestones must be approved before completion.'
        : message.includes('deliverable')
          ? 'All deliverables must be approved before completion.'
          : message.includes('revision')
            ? 'Resolve all revision requests before completion.'
            : 'Could not complete this commission.';
      setCompletionError(friendlyMessage);
      showToast(friendlyMessage);
    } finally {
      setCompletionLoading(false);
    }
  };

  const closeReviewDialog = () => {
    if (reviewSubmitting) return;
    setReviewDialogOpen(false);
    setReviewEditing(false);
    setReviewRating(null);
    setReviewText('');
    setReviewSubmitError(undefined);
  };

  const handleSubmitArtistReview = async () => {
    if (
      !realCommission
      || !user
      || user.role !== 'client'
      || user.id !== realCommission.client_id
      || realCommission.status !== 'COMPLETED'
      || reviewCheckState !== 'ready'
      || (reviewEditing ? !commissionReview || !canEditArtistReview(commissionReview) : commissionReview !== null)
      || reviewRating === null
      || !reviewText.trim()
      || reviewSubmitting
    ) return;

    setReviewSubmitting(true);
    setReviewSubmitError(undefined);
    try {
      if (reviewEditing && commissionReview) {
        const reviewId = 'review_id' in commissionReview ? commissionReview.review_id : commissionReview.id;
        const updatedReview = await updateArtistReview(reviewId, reviewRating, reviewText.trim());
        setCommissionReview((current) => current
          ? { ...current, rating: updatedReview.rating, review_text: updatedReview.review_text, edited_at: updatedReview.edited_at }
          : updatedReview);
      } else {
        const submittedReview = await submitArtistReview(realCommission.id, reviewRating, reviewText.trim());
        setCommissionReview(submittedReview);
      }
      setReviewDialogOpen(false);
      setReviewEditing(false);
      setReviewText('');
      setReviewRating(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setReviewSubmitError(!reviewEditing
        ? 'Could not submit review. Please try again.'
        : message.includes('REVIEW_EDIT_WINDOW_EXPIRED')
          ? 'The 7-day edit window has expired.'
          : message.includes('REVIEW_ALREADY_EDITED')
            ? 'This review has already been edited.'
            : message.includes('REVIEW_NOT_AUTHORIZED')
              ? 'Only the original Client can edit this review.'
              : message.includes('INVALID_REVIEW')
                ? 'Enter a rating from 1 to 5 and nonblank review text.'
                : 'Could not save this review. Please try again.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const refreshPaymentStatus = async () => {
    if (!realCommission || paymentLoading) return;
    setCommissionPayment(null);
    setPaymentStatusCommissionId(null);
    setPaymentLoading(true);
    setPaymentError(undefined);
    try {
      const payment = await getCommissionPayment(realCommission.id);
      setCommissionPayment(payment);
      setPaymentStatusCommissionId(realCommission.id);
    } catch {
      setPaymentError('Could not load payment status. Please try again.');
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleCreatePayment = async () => {
    if (
      !realCommission
      || !user
      || user.role !== 'client'
      || realCommission.client_id !== user.id
      || realCommission.status !== 'ACCEPTED'
      || !hasCommissionPaymentPrice(realCommission)
      || paymentActionInFlight.current
    ) return;

    paymentActionInFlight.current = true;
    setPaymentActionLoading(true);
    setPaymentError(undefined);
    try {
      setCommissionPayment(await createCommissionPayment(realCommission.id));
    } catch (error) {
      setPaymentError(error instanceof Error && error.message.includes('COMMISSION_PRICE_UNAVAILABLE')
        ? 'Payment unavailable for this commission.'
        : 'Could not create payment. Please try again.');
    } finally {
      paymentActionInFlight.current = false;
      setPaymentActionLoading(false);
    }
  };

  const handleSimulatePayment = async (outcome: 'success' | 'failure') => {
    if (
      !commissionPayment
      || !user
      || user.role !== 'client'
      || commissionPayment.payer_id !== user.id
      || commissionPayment.status !== 'PENDING'
      || paymentActionInFlight.current
    ) return;

    paymentActionInFlight.current = true;
    setPaymentActionLoading(true);
    setPaymentError(undefined);
    try {
      setCommissionPayment(outcome === 'success'
        ? await simulateCommissionPaymentSuccess(commissionPayment.id)
        : await simulateCommissionPaymentFailure(commissionPayment.id));
    } catch {
      setPaymentError('Could not update the simulated payment. Please try again.');
    } finally {
      paymentActionInFlight.current = false;
      setPaymentActionLoading(false);
    }
  };

  const handleRefundPayment = async () => {
    if (
      !realCommission
      || !user
      || user.role !== 'client'
      || realCommission.status !== 'CANCELLED'
      || !commissionPayment
      || commissionPayment.commission_id !== realCommission.id
      || commissionPayment.payer_id !== user.id
      || commissionPayment.payee_id !== realCommission.artist_id
      || commissionPayment.status !== 'PAID'
      || paymentActionInFlight.current
    ) return;

    paymentActionInFlight.current = true;
    setRefundSubmitting(true);
    setRefundError(undefined);
    try {
      const refundedPayment = await simulateCommissionPaymentRefund(commissionPayment.id);
      setCommissionPayment(refundedPayment);
      setRefundDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const friendlyMessage = message.includes('Only cancelled commissions')
        ? 'This commission must be cancelled before its payment can be refunded.'
        : message.includes('Only paid payments')
          ? 'Only a paid payment can be refunded.'
          : message.includes('does not match')
            ? 'This payment does not match the commission.'
            : 'Could not refund this payment. Please try again.';
      setRefundError(friendlyMessage);
    } finally {
      paymentActionInFlight.current = false;
      setRefundSubmitting(false);
    }
  };

  const handlePostProgress = async (event: FormEvent) => {
    event.preventDefault();
    if (!realCommission || postingProgress) return;
    const percent = Number(progressPercent);
    const note = progressNote.trim();
    if (!Number.isInteger(percent) || percent < 0 || percent > 100 || !note) {
      showToast('Enter progress from 0 to 100 and a note.');
      return;
    }
    setPostingProgress(true);
    try {
      const update = await createCommissionProgress(realCommission.id, percent, note);
      setProgressUpdates((current) => [update, ...current]);
      setProgressNote('');
      showToast('Progress update posted');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not post progress.');
    } finally {
      setPostingProgress(false);
    }
  };

  const handleDeliverableSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !realCommission || !user || user.id !== realCommission.artist_id) return;
    setUploadingDeliverable(true);
    try {
      const title = deliverableTitle.trim() || file.name.replace(/\.[^/.]+$/, '').trim() || 'Commission deliverable';
      const submitted = await uploadCommissionDeliverable(user.id, realCommission.id, title, deliverableDescription.trim(), file);
      setDeliverables((current) => [submitted, ...current]);
      setDeliverableTitle('');
      setDeliverableDescription('');
      if (submitted.protected_storage_path) {
        const url = await createCommissionDeliverableSignedUrl(realCommission.id, submitted);
        setDeliverableUrls((current) => ({ ...current, [submitted.id]: url }));
      }
      showToast('Deliverable submitted');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not submit deliverable.');
    } finally {
      setUploadingDeliverable(false);
    }
  };

  const handleApproveDeliverable = async (deliverableId: string) => {
    if (!realCommission || !user || user.id !== realCommission.client_id || approvingDeliverableId) return;
    if (!window.confirm('Approve this deliverable?')) return;
    setApprovingDeliverableId(deliverableId);
    try {
      const approved = await approveCommissionDeliverable(deliverableId);
      setDeliverables((current) => current.map((item) => item.id === approved.id ? approved : item));
      showToast('Deliverable Approved');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not approve deliverable.');
    } finally {
      setApprovingDeliverableId(null);
    }
  };

  const handleMessageCounterparty = async () => {
    if (!realCommission) return;
    const counterpartyId = realCommission.client_id === user?.id ? realCommission.artist_id : realCommission.client_id;
    const conversationId = await startConversation(counterpartyId);
    if (conversationId) navigate(`/chat/${conversationId}`);
    else showToast('Could not start the conversation. Please try again.');
  };

  if (!mockOrder) {
    if (realLoading) {
      return (
        <ScreenShell
          contentClassName="commission-workspace-content"
          header={
            <div className="px-hd commission-workspace-header">
              <IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" />
            </div>
          }
        >
          <div className="card t-sm c-mid" style={{ textAlign: 'center', padding: 24 }}>
            Loading commission…
          </div>
        </ScreenShell>
      );
    }

    if (realError || !realCommission || !user) {
      return (
        <ScreenShell
          contentClassName="commission-workspace-content"
          header={
            <div className="px-hd commission-workspace-header">
              <IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" />
            </div>
          }
        >
          <div className="card t-sm c-mid" style={{ textAlign: 'center', padding: 24 }}>
            This commission couldn&apos;t be found, or your account isn&apos;t one of its two real parties.
          </div>
        </ScreenShell>
      );
    }

    const isClient = realCommission.client_id === user.id;
    const canManagePayment = isClient && user.role === 'client';
    const canRefundPayment = canManagePayment
      && realCommission.status === 'CANCELLED'
      && paymentStatusCommissionId === realCommission.id
      && !paymentLoading
      && Boolean(commissionPayment)
      && commissionPayment?.commission_id === realCommission.id
      && commissionPayment?.payer_id === user.id
      && commissionPayment?.payee_id === realCommission.artist_id
      && commissionPayment?.status === 'PAID';
    const paymentAvailable = hasCommissionPaymentPrice(realCommission);
    const showPaymentPanel = realCommission.status === 'ACCEPTED' || commissionPayment !== null;
    const isPublicPostCommission = realCommission.public_post_id !== null;
    const requiresPaidPaymentBeforeStart = realCommission.service_id !== null || isPublicPostCommission;
    const paymentStatusKnown = paymentStatusCommissionId === realCommission.id && !paymentLoading && !paymentError;
    const matchingPaymentIsPaid = paymentStatusKnown
      && commissionPayment?.commission_id === realCommission.id
      && commissionPayment.payer_id === realCommission.client_id
      && commissionPayment.payee_id === realCommission.artist_id
      && commissionPayment.amount === realCommission.amount
      && commissionPayment.currency === realCommission.currency
      && commissionPayment.status === 'PAID';
    const matchingPaymentParties = paymentStatusKnown
      && commissionPayment?.commission_id === realCommission.id
      && commissionPayment.payer_id === realCommission.client_id
      && commissionPayment.payee_id === realCommission.artist_id;
    const paymentAmountMatchesCommission = realCommission.amount !== null
      && realCommission.amount !== undefined
      && commissionPayment?.amount === realCommission.amount
      && commissionPayment.currency === realCommission.currency;
    const matchingPaymentRefunded = matchingPaymentParties
      && paymentAmountMatchesCommission
      && commissionPayment.status === 'REFUNDED';
    const escrowStatus = paymentLoading
      ? 'CHECKING PAYMENT'
      : !paymentStatusKnown
        ? 'STATUS UNAVAILABLE'
        : matchingPaymentRefunded
          ? 'REFUNDED'
          : matchingPaymentIsPaid
            ? 'ESCROW NOT TRACKED'
            : matchingPaymentParties
              && (commissionPayment.status === 'PAID' || commissionPayment.status === 'REFUNDED')
              && !paymentAmountMatchesCommission
              ? 'PAYMENT MISMATCH'
            : matchingPaymentParties && commissionPayment.status === 'VOIDED'
              ? 'VOIDED'
              : matchingPaymentParties && commissionPayment.status === 'FAILED'
                ? 'PAYMENT FAILED'
                : matchingPaymentParties && commissionPayment.status === 'PENDING'
                  ? 'AWAITING PAYMENT'
                  : realCommission.status === 'REQUESTED'
                    ? 'NOT YET PAYABLE'
                    : realCommission.status === 'ACCEPTED' && paymentAvailable
                      ? 'AWAITING PAYMENT'
                      : !paymentAvailable
                        ? 'AMOUNT UNAVAILABLE'
                        : commissionPayment
                          ? 'PAYMENT DETAILS UNAVAILABLE'
                          : 'NOT PAID';
    const escrowStatusClass = matchingPaymentIsPaid
      ? 'badge-accent'
      : matchingPaymentRefunded
        ? 'badge-success'
        : escrowStatus === 'PAYMENT FAILED'
          ? 'badge-danger'
          : escrowStatus === 'AWAITING PAYMENT' || escrowStatus === 'AMOUNT UNAVAILABLE' || escrowStatus === 'PAYMENT MISMATCH'
            ? 'badge-warning'
            : 'badge-accent';
      const isReviewEligibleClient = isClient && user.role === 'client';
    const reviewEditEligible = isReviewEligibleClient
      && realCommission.status === 'COMPLETED'
      && reviewCheckState === 'ready'
      && commissionReview !== null
      && canEditArtistReview(commissionReview);
    const dueAt = getCommissionDueAt(realCommission);
    const now = new Date();
    const isActiveDeadlineStatus = realCommission.status === 'IN_PROGRESS' || realCommission.status === 'REVISION_REQUESTED';
    const isHistoricalDeadlineStatus = realCommission.status === 'COMPLETED' || realCommission.status === 'CANCELLED';
    const deadlineOverdue = isActiveDeadlineStatus && isCommissionOverdue(realCommission, now);
    const dueAtMilliseconds = dueAt ? Date.parse(dueAt) : Number.NaN;
    const remainingMilliseconds = dueAtMilliseconds - now.getTime();
    const remainingDays = remainingMilliseconds > 0 ? Math.ceil(remainingMilliseconds / 86_400_000) : 0;
    const overdueWholeDays = deadlineOverdue ? Math.floor((now.getTime() - dueAtMilliseconds) / 86_400_000) : 0;
    const completionReady = realCommission.status === 'IN_PROGRESS' || realCommission.status === 'REVISION_REQUESTED'
      ? milestones.length > 0
        && milestones.every((milestone) => milestone.status === 'APPROVED')
        && !deliverablesLoading
        && !deliverablesError
        && deliverables.every((deliverable) => deliverable.status === 'APPROVED')
        && !revisionRequestsLoading
        && revisionRequests.every((revision) => revision.status === 'RESOLVED')
      : false;

    return (
      <ScreenShell
        contentClassName="commission-workspace-content"
        header={
          <div className="px-hd row-between commission-workspace-header">
            <div className="row gap-10">
              <IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" />
              <div>
                <div className="t-md fw-700">{realCommission.title}</div>
                <div className="t-xs c-low">{realCommission.order_ref}</div>
              </div>
            </div>
          </div>
        }
      >
        <section className="card workspace-summary-card ag-liquid-glass-soft" style={{ marginBottom: 16, padding: '14px 16px' }}>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div className="section-title">Commission Overview</div>
              <div className="t-xs c-low" style={{ marginTop: 3 }}>{realCommission.order_ref}</div>
            </div>
            <span className={`badge ${realCommission.status === 'REQUESTED' || realCommission.status === 'REVISION_REQUESTED' ? 'badge-warning' : realCommission.status === 'REJECTED' || realCommission.status === 'CANCELLED' ? 'badge-danger' : realCommission.status === 'COMPLETED' ? 'badge-success' : 'badge-accent'}`}>
              {COMMISSION_STATUS_LABELS[realCommission.status]}
            </span>
          </div>
          <div className="row gap-10 workspace-counterparty" style={{ alignItems: 'center' }}>
            <div
              className="avatar avatar-sm"
              style={realCounterparty?.avatar_data_url ? { backgroundImage: `url(${realCounterparty.avatar_data_url})`, backgroundSize: 'cover' } : {}}
            >
              {!realCounterparty?.avatar_data_url && initialsFor(realCounterparty?.name ?? '?')}
            </div>
            <div style={{ textAlign: 'left', minWidth: 0 }}>
              <div className="t-sm fw-700">{realCounterparty?.name ?? 'Unknown'}</div>
              <div className="t-xs c-low">{isClient ? 'Artist' : 'Client'} · {isClient ? 'Your artist' : 'Your client'}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void handleMessageCounterparty()}>
              <Icon name="chat" style={{ width: 14, height: 14 }} />
              {isClient ? 'Message Artist' : 'Message Client'}
            </button>
          </div>
          {((isClient && ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED'].includes(realCommission.status))
            || (!isClient && ['ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED'].includes(realCommission.status))) && (
            <button type="button" className="btn btn-ghost btn-sm commission-cancel-button" style={{ marginTop: 10, color: 'var(--ag-danger)' }} onClick={openCancellationDialog} disabled={cancellingCommission}>
              {cancellingCommission ? 'Cancelling…' : 'Cancel Commission'}
            </button>
          )}
          <div className="workspace-summary-details" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '10px 18px', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--ag-border-soft)' }}>
            <div><div className="t-xs c-low">Title</div><div className="t-sm fw-600">{realCommission.title}</div></div>
            {realCommission.service_name_snapshot && <div><div className="t-xs c-low">Service</div><div className="t-sm c-mid">{realCommission.service_name_snapshot}</div></div>}
            {realCommission.amount !== null && realCommission.amount !== undefined && realCommission.currency && <div><div className="t-xs c-low">Agreed price</div><div className="t-sm c-mid">{realCommission.currency} {realCommission.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>}
            {realCommission.turnaround_days_snapshot && <div><div className="t-xs c-low">Turnaround</div><div className="t-sm c-mid">{realCommission.turnaround_days_snapshot} days</div></div>}
            {formatCommissionDate(realCommission.requested_at) && <div><div className="t-xs c-low">Requested</div><div className="t-sm c-mid">{formatCommissionDate(realCommission.requested_at)}</div></div>}
            {formatCommissionDate(realCommission.accepted_at) && <div><div className="t-xs c-low">Accepted</div><div className="t-sm c-mid">{formatCommissionDate(realCommission.accepted_at)}</div></div>}
            {formatCommissionDate(realCommission.started_at) && <div><div className="t-xs c-low">Started</div><div className="t-sm c-mid">{formatCommissionDate(realCommission.started_at)}</div></div>}
            {realCommission.status !== 'REJECTED' && (
              <div>
                <div className="t-xs c-low">Deadline</div>
                {dueAt && (isActiveDeadlineStatus || isHistoricalDeadlineStatus) ? (
                  <>
                    <div className="t-sm c-mid">Due {formatCommissionDate(dueAt)}</div>
                    {isActiveDeadlineStatus && (deadlineOverdue ? (
                      <div className="t-xs c-danger" style={{ marginTop: 3 }}>
                        {overdueWholeDays > 0 ? `Overdue by ${overdueWholeDays} day${overdueWholeDays === 1 ? '' : 's'}` : 'Overdue by less than 1 day'}
                      </div>
                    ) : remainingMilliseconds === 0 ? (
                      <div className="t-xs c-warning" style={{ marginTop: 3 }}>Due now</div>
                    ) : (
                      <div className="t-xs c-low" style={{ marginTop: 3 }}>{remainingDays} day{remainingDays === 1 ? '' : 's'} remaining</div>
                    ))}
                  </>
                ) : (
                  <div className="t-sm c-mid">No deadline set</div>
                )}
              </div>
            )}
            {formatCommissionDate(realCommission.rejected_at) && <div><div className="t-xs c-low">Rejected</div><div className="t-sm c-danger">{formatCommissionDate(realCommission.rejected_at)}</div></div>}
          </div>
          {realCommission.status === 'REQUESTED' && <div className="t-xs c-warning" style={{ marginTop: 12 }}>Awaiting the artist&apos;s response.</div>}
          {realCommission.status === 'ACCEPTED' && <div className="t-xs c-success" style={{ marginTop: 12 }}>Commission request accepted.</div>}
          {realCommission.status === 'REJECTED' && <div className="t-xs c-danger" style={{ marginTop: 8 }}>Commission request rejected{isClient && realCommission.rejection_reason ? `: ${realCommission.rejection_reason}` : '.'}</div>}
          {realCommission.status === 'CANCELLED' && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--ag-border-soft)' }}>
              <div className="section-title" style={{ marginBottom: 6 }}>Commission Cancelled</div>
              {realCommission.cancelled_at && <div className="t-xs c-low">Cancelled {formatCommissionDate(realCommission.cancelled_at)}</div>}
              {realCommission.cancelled_by && <div className="t-xs c-low" style={{ marginTop: 3 }}>Cancelled by {realCommission.cancelled_by === realCommission.client_id ? 'Client' : 'Artist'}</div>}
              {realCommission.cancellation_reason && <div className="t-sm c-mid" style={{ marginTop: 8, lineHeight: 1.5 }}>{realCommission.cancellation_reason}</div>}
            </div>
          )}
          {realCommission.status === 'COMPLETED' && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--ag-border-soft)' }}>
              <div className="section-title" style={{ marginBottom: 6 }}>Commission Completed</div>
              {realCommission.completed_at && <div className="t-xs c-success">Completed {formatCommissionDate(realCommission.completed_at)}</div>}
              {isReviewEligibleClient && reviewCheckState === 'loading' && <div className="t-xs c-low" role="status" style={{ marginTop: 10 }}>Checking review status…</div>}
              {isReviewEligibleClient && reviewCheckState === 'error' && (
                <div style={{ marginTop: 10 }}>
                  <div className="t-xs c-danger" role="alert">Could not check review status.</div>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setReviewCheckRetry((retry) => retry + 1)}>Try again</button>
                </div>
              )}
              {isReviewEligibleClient && reviewCheckState === 'ready' && commissionReview && (
                <div style={{ marginTop: 10 }}>
                  <div className="t-sm fw-700 c-success">Review Submitted</div>
                  {commissionReview.edited_at && <div className="t-xs c-low" style={{ marginTop: 4 }}>Edited</div>}
                  <div className="row gap-8" aria-label={`Rating: ${commissionReview.rating} out of 5`} style={{ marginTop: 6 }}>
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <Icon key={rating} name="star" style={{ width: 14, height: 14, stroke: 'none', fill: rating <= commissionReview.rating ? 'var(--ag-amber)' : 'var(--ag-border)' }} />
                    ))}
                  </div>
                  <div className="t-sm c-mid" style={{ marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{commissionReview.review_text}</div>
                  {reviewEditEligible && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: 10 }}
                      onClick={() => {
                        setReviewEditing(true);
                        setReviewRating(commissionReview.rating);
                        setReviewText(commissionReview.review_text);
                        setReviewSubmitError(undefined);
                        setReviewDialogOpen(true);
                      }}
                    >
                      Edit Review
                    </button>
                  )}
                </div>
              )}
              {isReviewEligibleClient && reviewCheckState === 'ready' && !commissionReview && (
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => setReviewDialogOpen(true)}>
                  Leave a Review
                </button>
              )}
            </div>
          )}
          {isClient && !['COMPLETED', 'CANCELLED'].includes(realCommission.status) && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--ag-border-soft)' }}>
              {completionReady ? (
                <button type="button" className="btn btn-secondary btn-sm commission-complete-button" onClick={() => setCompletionDialogOpen(true)} disabled={completionLoading}>
                  Complete Commission
                </button>
              ) : (
                <div className="t-xs c-low">Complete all milestones, approve any deliverables, and resolve all revisions before completing this commission.</div>
              )}
              {completionError && <div className="t-xs c-danger" role="alert" style={{ marginTop: 8 }}>{completionError}</div>}
            </div>
          )}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--ag-border-soft)' }}>
            <div className="section-title" style={{ marginBottom: 6 }}>Requirements / Brief</div>
            <div className="t-sm c-mid" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{realCommission.description || 'No requirements provided yet.'}</div>
          </div>
        </section>

        {showPaymentPanel && (
          <section className="card workspace-payment-card ag-liquid-glass-soft" style={{ marginBottom: 16, padding: '14px 16px' }} aria-label="Commission payment">
            <div className="section-title" style={{ marginBottom: 8 }}>Payment</div>
            {paymentLoading ? (
              <div className="t-xs c-low" role="status">Loading payment status…</div>
            ) : (
              <>
                {paymentAvailable && (
                  <div className="t-sm c-mid" style={{ marginBottom: 8 }}>
                    {realCommission.currency} {realCommission.amount!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                )}
                {!paymentAvailable && !commissionPayment && (
                  <div className="t-xs c-low" style={{ marginBottom: 8 }}>Payment unavailable for this commission.</div>
                )}
                {commissionPayment?.status === 'PENDING' && <div className="t-sm c-warning">Payment: PENDING</div>}
                {commissionPayment?.status === 'PAID' && (
                  <div className="t-sm c-success">
                    Payment: PAID{commissionPayment.paid_at ? ` · ${formatCommissionDate(commissionPayment.paid_at)}` : ''}
                  </div>
                )}
                {commissionPayment?.status === 'FAILED' && <div className="t-sm c-danger">Payment: FAILED</div>}
                {commissionPayment?.status === 'VOIDED' && <div className="t-sm c-mid">Payment: VOIDED</div>}
                {commissionPayment?.status === 'REFUNDED' && (
                  <div>
                    <div className="t-sm c-success">Payment Refunded</div>
                    {commissionPayment.refunded_amount !== null && (
                      <div className="t-sm c-mid" style={{ marginTop: 4 }}>
                        {commissionPayment.currency} {commissionPayment.refunded_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    )}
                    {commissionPayment.refunded_at && <div className="t-xs c-low" style={{ marginTop: 3 }}>Refunded {formatCommissionDate(commissionPayment.refunded_at)}</div>}
                  </div>
                )}
                {!commissionPayment && realCommission.status === 'ACCEPTED' && paymentAvailable && (
                  <div className="t-sm c-mid">PENDING / NOT PAID</div>
                )}
                {canManagePayment && realCommission.status === 'ACCEPTED' && paymentAvailable && !commissionPayment && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: 10 }}
                    onClick={() => void handleCreatePayment()}
                    disabled={paymentActionLoading || paymentLoading}
                  >
                    {paymentActionLoading ? 'Creating payment…' : 'Pay Commission'}
                  </button>
                )}
                {canManagePayment && realCommission.status === 'ACCEPTED' && paymentAvailable && commissionPayment?.status === 'FAILED' && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: 10 }}
                    onClick={() => void handleCreatePayment()}
                    disabled={paymentActionLoading || paymentLoading}
                  >
                    {paymentActionLoading ? 'Creating payment…' : 'Try Payment Again'}
                  </button>
                )}
                {canManagePayment && commissionPayment?.status === 'PENDING' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleSimulatePayment('success')} disabled={paymentActionLoading}>
                      {paymentActionLoading ? 'Updating…' : 'Simulate Successful Payment'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleSimulatePayment('failure')} disabled={paymentActionLoading}>
                      Simulate Payment Failure
                    </button>
                  </div>
                )}
                {paymentError && <div className="t-xs c-danger" role="alert" style={{ marginTop: 8 }}>{paymentError}</div>}
                {canManagePayment && commissionPayment?.status === 'PENDING' && (
                  <div className="t-xs c-low" style={{ marginTop: 8 }}>School-project simulation only. No real payment is processed.</div>
                )}
                {canRefundPayment && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: 10 }}
                    onClick={() => { setRefundError(undefined); setRefundDialogOpen(true); }}
                    disabled={refundSubmitting || paymentActionLoading}
                  >
                    Refund Payment
                  </button>
                )}
                {canManagePayment && commissionPayment?.status === 'REFUNDED' && (
                  <div className="t-xs c-low" style={{ marginTop: 8 }}>School-project simulation only. No real money movement occurred.</div>
                )}
              </>
            )}
          </section>
        )}

        {realCommission.status === 'ACCEPTED' && (
          <div className="card" style={{ marginBottom: 16 }}>
            {isClient ? (
              <div className="t-sm c-mid">Waiting for the artist to start work.</div>
            ) : (
              <>
                <div className="section-title" style={{ marginBottom: 8 }}>Ready to begin?</div>
                {isPublicPostCommission && (
                  <div className="t-xs c-low" style={{ marginBottom: 8 }}>
                    Payment is required before work can begin.
                  </div>
                )}
                {requiresPaidPaymentBeforeStart && !matchingPaymentIsPaid && (
                  <div className="t-xs c-low" style={{ marginBottom: 8 }}>
                    {paymentError
                      ? 'Could not verify payment status.'
                      : paymentLoading || !paymentStatusKnown
                        ? 'Checking payment status before start…'
                        : !paymentAvailable
                          ? 'Commission price unavailable. Contact support.'
                          : 'Payment required before starting this commission.'}
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleStartCommission()}
                  disabled={startingCommission || (requiresPaidPaymentBeforeStart && !matchingPaymentIsPaid)}
                >
                  {startingCommission ? 'Starting…' : 'Start Commission'}
                </button>
                {requiresPaidPaymentBeforeStart && !matchingPaymentIsPaid && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 8 }}
                    onClick={() => void refreshPaymentStatus()}
                    disabled={paymentLoading}
                  >
                    {paymentLoading ? 'Checking…' : 'Refresh payment status'}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {(realCommission.status === 'ACCEPTED' || realCommission.status === 'IN_PROGRESS' || realCommission.status === 'REVISION_REQUESTED') && (
          <section className="card workspace-milestone-card ag-liquid-glass-soft" style={{ marginBottom: 16 }}>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="section-title">Milestone Progress</span>
              {progressUpdates[0] && <span className="badge badge-accent">{progressUpdates[0].progress_percent}%</span>}
            </div>
            {milestonesLoading && <div className="t-xs c-low" role="status">Loading milestones...</div>}
            {!milestonesLoading && milestonesError && <div className="t-xs c-danger" role="alert">Could not load milestones.</div>}
            {!milestonesLoading && !milestonesError && milestones.length === 0 && <div className="t-xs c-low">No milestones yet.</div>}
            {!milestonesLoading && !milestonesError && milestones.length > 0 && (
              <div className="workspace-milestone-list" style={{ position: 'relative', paddingLeft: 4 }}>
                <div className="workspace-milestone-track" style={{ position: 'absolute', left: 13, top: 8, bottom: 8, width: 2, background: 'var(--ag-border-soft)' }} />
                <div className="workspace-milestone-items" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {milestones.map((milestone, index) => {
                    const statusKey: keyof typeof STATUS_DOT_STYLE = milestone.status === 'APPROVED'
                      ? 'approved'
                      : milestone.status === 'PENDING'
                        ? 'pending'
                        : 'in-progress';
                    const milestoneDate = milestone.approved_at ?? milestone.submitted_at ?? milestone.started_at;
                    const isArtist = user.id === realCommission.artist_id;
                    const isClient = user.id === realCommission.client_id;
                    const canStart = isArtist
                      && milestone.status === 'PENDING'
                      && milestones.slice(0, index).every((previous) => previous.status === 'SUBMITTED' || previous.status === 'APPROVED');
                    return (
                      <div className="row gap-12 workspace-milestone-item" key={milestone.id} style={{ position: 'relative' }}>
                        <div className="workspace-milestone-dot" data-status={milestone.status} style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, position: 'relative', ...STATUS_DOT_STYLE[statusKey] }}>
                          {milestone.status === 'APPROVED' && <Icon name="check-circle" style={{ width: 14, height: 14, stroke: '#08110c' }} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="row-between gap-10">
                            <span className={`t-sm fw-700${milestone.status === 'PENDING' ? ' c-low' : ''}`}>{milestone.sort_order}. {milestone.name}</span>
                            <span className="t-xs c-low workspace-milestone-status">{milestone.status.replace('_', ' ')}</span>
                          </div>
                          {(milestone.note || milestoneDate) && <div className="t-xs c-low" style={{ marginTop: 3 }}>{milestone.note}{milestone.note && milestoneDate ? ' · ' : ''}{milestoneDate ? new Date(milestoneDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</div>}
                          {canStart && (
                            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => void handleStartMilestone(milestone.id)} disabled={milestoneActionId !== null}>
                              {milestoneActionId === milestone.id ? 'Starting…' : 'Start'}
                            </button>
                          )}
                          {isArtist && milestone.status === 'IN_PROGRESS' && (
                            <div style={{ marginTop: 8 }}>
                              <textarea
                                className="textarea-field"
                                rows={2}
                                value={milestoneNoteId === milestone.id ? milestoneNote : ''}
                                onChange={(event) => { setMilestoneNoteId(milestone.id); setMilestoneNote(event.target.value); }}
                                placeholder="Optional milestone note"
                                aria-label={`Note for ${milestone.name}`}
                                style={{ marginBottom: 8 }}
                              />
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleSubmitMilestone(milestone.id)} disabled={milestoneActionId !== null}>
                                {milestoneActionId === milestone.id ? 'Submitting…' : 'Submit Milestone'}
                              </button>
                            </div>
                          )}
                          {isArtist && milestone.status === 'SUBMITTED' && <div className="t-xs c-low" style={{ marginTop: 8 }}>Awaiting client approval</div>}
                          {isClient && milestone.status === 'SUBMITTED' && (
                            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => void handleApproveMilestone(milestone.id)} disabled={milestoneActionId !== null}>
                              {milestoneActionId === milestone.id ? 'Approving…' : 'Approve'}
                            </button>
                          )}
                          {milestone.status === 'APPROVED' && <div className="t-xs c-success" style={{ marginTop: 8 }}>Approved{milestone.approved_at ? ` · ${new Date(milestone.approved_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
        {(realCommission.status === 'IN_PROGRESS' || realCommission.status === 'REVISION_REQUESTED') && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--ag-border-soft)' }}>
            <div className="t-xs c-low" style={{ marginBottom: 8 }}>Latest update</div>
            {progressUpdates[0] && <div className="t-sm c-mid" style={{ marginBottom: 10 }}>{progressUpdates[0].progress_percent}% · &quot;{progressUpdates[0].note}&quot; <span className="t-xs c-low">{new Date(progressUpdates[0].created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span></div>}
            {progressLoading && <div className="t-xs c-low" role="status">Loading progress…</div>}
            {!progressLoading && progressError && <div className="t-xs c-danger" role="alert">{progressError}</div>}
            {!progressLoading && !progressError && progressUpdates.length === 0 && <div className="t-xs c-low">No progress updates yet.</div>}
            {!progressLoading && !progressError && progressUpdates.length > 1 && <div className="t-xs c-low" style={{ marginBottom: 6 }}>Progress history</div>}
            {!progressLoading && !progressError && progressUpdates.slice(1).map((update) => (
              <div key={update.id} style={{ padding: '8px 0', borderTop: '1px solid var(--ag-border-soft)' }}>
                <div className="row-between gap-10">
                  <span className="t-sm fw-700">{update.progress_percent}%</span>
                  <span className="t-xs c-low">{new Date(update.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
                <div className="t-xs c-mid" style={{ marginTop: 4, lineHeight: 1.5 }}>{update.note}</div>
              </div>
            ))}
            {!isClient && (
              <form onSubmit={(event) => void handlePostProgress(event)} style={{ marginTop: 10, paddingTop: 12, borderTop: '1px solid var(--ag-border-soft)' }}>
                <label className="field-label" htmlFor="progress-percent">Progress</label>
                <input id="progress-percent" className="input-field" type="number" min="0" max="100" step="1" value={progressPercent} onChange={(event) => setProgressPercent(event.target.value)} style={{ marginBottom: 10 }} />
                <label className="field-label" htmlFor="progress-note">Update</label>
                <textarea id="progress-note" className="textarea-field" rows={3} value={progressNote} onChange={(event) => setProgressNote(event.target.value)} placeholder="Describe the latest work update." style={{ marginBottom: 10 }} />
                <button type="submit" className="btn btn-secondary" disabled={postingProgress}>{postingProgress ? 'Posting…' : 'Post Progress Update'}</button>
              </form>
            )}
          </div>
        )}
          </section>
        )}

        <section className="card workspace-escrow-card ag-liquid-glass-soft" aria-label="Escrow status">
          <div className="row-between workspace-escrow-heading">
            <span className="section-title">Escrow Status</span>
            <span className={`badge ${escrowStatusClass}`}>{escrowStatus}</span>
          </div>
          <div className="workspace-escrow-total">
            <span className="t-xs c-low">Total commission</span>
            <span className="mono fw-700 workspace-escrow-amount">
              {hasCommissionPaymentPrice(realCommission)
                ? `${realCommission.currency} ${realCommission.amount!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : 'Unavailable'}
            </span>
          </div>
          <div className="workspace-escrow-breakdown">
            <div>
              <span className="t-xs c-low">Released</span>
              <span className="t-sm fw-700">Not tracked</span>
            </div>
            <div>
              <span className="t-xs c-low">Held</span>
              <span className="t-sm fw-700">Not tracked</span>
            </div>
          </div>
          {matchingPaymentRefunded && commissionPayment.refunded_amount !== null && (
            <div className="workspace-escrow-refund">
              <span className="t-xs c-low">Refund recorded (simulated)</span>
              <span className="mono fw-700 workspace-escrow-amount">
                {commissionPayment.currency} {commissionPayment.refunded_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          <p className="t-xs c-low workspace-escrow-note">
            Payment status is simulated. Escrow custody and milestone-based fund releases are not tracked by this app.
          </p>
        </section>

        {(realCommission.status === 'IN_PROGRESS' || realCommission.status === 'REVISION_REQUESTED' || realCommission.status === 'ACCEPTED') && (
          <section className="card" style={{ marginBottom: 16 }}>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="section-title">Commission Deliverables</span>
              {!isClient && (realCommission.status === 'IN_PROGRESS' || realCommission.status === 'REVISION_REQUESTED') && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => deliverableFileRef.current?.click()} disabled={uploadingDeliverable}>
                  {uploadingDeliverable ? 'Processing…' : 'Upload Deliverable'}
                </button>
              )}
            </div>
            <input ref={deliverableFileRef} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={(event) => void handleDeliverableSelected(event)} />
            {!isClient && (realCommission.status === 'IN_PROGRESS' || realCommission.status === 'REVISION_REQUESTED') && (
              <div style={{ marginBottom: 10 }}>
                <label className="field-label" htmlFor="deliverable-title">Title</label>
                <input id="deliverable-title" className="input-field" value={deliverableTitle} onChange={(event) => setDeliverableTitle(event.target.value)} placeholder="Final character render" style={{ marginBottom: 8 }} />
                <label className="field-label" htmlFor="deliverable-description">Description (optional)</label>
                <textarea id="deliverable-description" className="textarea-field" rows={2} value={deliverableDescription} onChange={(event) => setDeliverableDescription(event.target.value)} placeholder="Describe this submission." style={{ marginBottom: 8 }} />
              </div>
            )}
            {deliverablesLoading && <div className="t-xs c-low" role="status">Loading deliverables…</div>}
            {!deliverablesLoading && deliverablesError && <div className="t-xs c-danger" role="alert">{deliverablesError}</div>}
            {!deliverablesLoading && !deliverablesError && deliverables.filter((item) => isClient ? ['SUBMITTED', 'APPROVED'].includes(item.status) : true).length === 0 && <div className="t-xs c-low">No deliverables submitted yet.</div>}
            {!deliverablesLoading && !deliverablesError && deliverables.filter((item) => isClient ? ['SUBMITTED', 'APPROVED'].includes(item.status) : true).map((deliverable) => (
              <article key={deliverable.id} style={{ borderTop: '1px solid var(--ag-border-soft)', paddingTop: 10, marginTop: 10 }}>
                {deliverableUrls[deliverable.id] && <ProtectedArtworkDisplay src={deliverableUrls[deliverable.id]} alt={`${deliverable.title} protected deliverable`} fitMode="contain" />}
                <div className="row-between" style={{ marginTop: 8 }}>
                  <span className="t-sm fw-700">{deliverable.title}</span>
                  <span className={`badge ${deliverable.status === 'SUBMITTED' || deliverable.status === 'APPROVED' ? 'badge-success' : deliverable.status === 'FAILED' ? 'badge-danger' : 'badge-warning'}`}>{deliverable.status}</span>
                </div>
                {deliverable.description && <div className="t-xs c-mid" style={{ marginTop: 4 }}>{deliverable.description}</div>}
                {deliverable.submitted_at && <div className="t-xs c-low" style={{ marginTop: 5 }}>Submitted {new Date(deliverable.submitted_at).toLocaleString()}</div>}
                {isClient && deliverable.status === 'SUBMITTED' && (
                  <div className="row gap-10" style={{ marginTop: 10 }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setReviewDeliverableId(deliverable.id); setRevisionSectionVisible(true); }}>Request Revision</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={approvingDeliverableId === deliverable.id} onClick={() => void handleApproveDeliverable(deliverable.id)}>
                      {approvingDeliverableId === deliverable.id ? 'Approving…' : 'Approve Deliverable'}
                    </button>
                  </div>
                )}
                {deliverable.status === 'APPROVED' && <div className="t-xs c-success" style={{ marginTop: 8 }}>Deliverable Approved</div>}
              </article>
            ))}
          </section>
        )}

        {['ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED', 'COMPLETED'].includes(realCommission.status) && (
          <div style={realCommission.status === 'COMPLETED' || revisionSectionVisible ? undefined : { display: 'none' }}>
            <RevisionRequests
              commissionId={realCommission.id}
              orderTitle={realCommission.title}
              deliverableId={reviewDeliverableId}
              readOnly={realCommission.status === 'COMPLETED'}
              onRevisionCountChange={(count) => { if (count > 0) setRevisionSectionVisible(true); }}
            />
          </div>
        )}
        {completionDialogOpen && (
          <div className="account-dialog-backdrop" role="presentation" onClick={() => !completionLoading && setCompletionDialogOpen(false)}>
            <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="complete-commission-title" onClick={(event) => event.stopPropagation()}>
              <div className="account-dialog-icon"><Icon name="check-circle" /></div>
              <h2 id="complete-commission-title">Complete Commission?</h2>
              <p>This will close the commission. You will still be able to view its history.</p>
              <div className="account-dialog-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCompletionDialogOpen(false)} disabled={completionLoading}>Keep Working</button>
                <button type="button" className="btn btn-secondary btn-sm account-danger-button" onClick={() => void handleCompleteCommission()} disabled={completionLoading}>
                  {completionLoading ? 'Completing…' : 'Complete Commission'}
                </button>
              </div>
            </section>
          </div>
        )}
        {reviewDialogOpen && isReviewEligibleClient && realCommission.status === 'COMPLETED' && reviewCheckState === 'ready' && (reviewEditing ? commissionReview !== null : !commissionReview) && (
          <div className="account-dialog-backdrop" role="presentation" onClick={closeReviewDialog}>
            <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="artist-review-title" onClick={(event) => event.stopPropagation()}>
              <div className="account-dialog-icon"><Icon name="star" /></div>
              <h2 id="artist-review-title">{reviewEditing ? 'Edit Review' : 'Leave a Review'}</h2>
              <label className="field-label" id="artist-review-rating-label">Rating</label>
              <div className="row gap-8" role="group" aria-labelledby="artist-review-rating-label" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
                    aria-pressed={reviewRating === rating}
                    onClick={() => setReviewRating(rating)}
                    style={{ minWidth: 42, background: reviewRating === rating ? 'var(--ag-accent)' : undefined }}
                  >
                    <Icon name="star" style={{ width: 14, height: 14, stroke: 'none', fill: 'currentColor' }} />
                    {rating}
                  </button>
                ))}
              </div>
              <label className="field-label" htmlFor="artist-review-text">Review</label>
              <textarea
                id="artist-review-text"
                className="textarea-field"
                rows={4}
                value={reviewText}
                onChange={(event) => setReviewText(event.target.value)}
                placeholder={reviewEditing ? undefined : 'Share your experience with this commission...'}
                maxLength={2000}
                autoFocus
              />
              {reviewSubmitError && <div className="t-xs c-danger" role="alert" style={{ marginTop: 8 }}>{reviewSubmitError}</div>}
              <div className="account-dialog-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeReviewDialog} disabled={reviewSubmitting}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void handleSubmitArtistReview()}
                  disabled={reviewSubmitting || reviewRating === null || !reviewText.trim()}
                >
                  {reviewSubmitting ? (reviewEditing ? 'Saving…' : 'Submitting…') : (reviewEditing ? 'Save Changes' : 'Submit Review')}
                </button>
              </div>
            </section>
          </div>
        )}
        {cancellationDialogOpen && (
          <div className="account-dialog-backdrop" role="presentation" onClick={() => !cancellingCommission && setCancellationDialogOpen(false)}>
            <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-commission-title" onClick={(event) => event.stopPropagation()}>
              <div className="account-dialog-icon">
                <Icon name="alert" />
              </div>
              <h2 id="cancel-commission-title">Cancel Commission?</h2>
              <p>This action cannot be undone.</p>
              <label className="field-label" htmlFor="cancellation-reason">Why are you cancelling this commission?</label>
              <textarea
                id="cancellation-reason"
                className="textarea-field"
                value={cancellationReason}
                onChange={(event) => setCancellationReason(event.target.value)}
                placeholder="Enter a reason"
                rows={4}
                autoFocus
              />
              <div className="account-dialog-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancellationDialogOpen(false)} disabled={cancellingCommission}>Keep Commission</button>
                <button type="button" className="btn btn-secondary btn-sm account-danger-button" onClick={() => void handleCancelCommission()} disabled={cancellingCommission || !cancellationReason.trim()}>
                  {cancellingCommission ? 'Cancelling…' : 'Cancel Commission'}
                </button>
              </div>
            </section>
          </div>
        )}
        {refundDialogOpen && canRefundPayment && commissionPayment && (
          <div className="account-dialog-backdrop" role="presentation" onClick={() => !refundSubmitting && setRefundDialogOpen(false)}>
            <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="refund-payment-title" onClick={(event) => event.stopPropagation()}>
              <div className="account-dialog-icon"><Icon name="alert" /></div>
              <h2 id="refund-payment-title">Refund this payment?</h2>
              <p>This will simulate a full refund of the original payment amount.</p>
              <div className="t-sm fw-700" style={{ marginBottom: 8, overflowWrap: 'anywhere' }}>
                {commissionPayment.currency} {commissionPayment.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="t-xs c-low">School-project simulation only. No real money movement occurs.</div>
              {refundError && <div className="t-xs c-danger" role="alert" style={{ marginTop: 10 }}>{refundError}</div>}
              <div className="account-dialog-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefundDialogOpen(false)} disabled={refundSubmitting}>Keep Payment</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleRefundPayment()} disabled={refundSubmitting || paymentActionLoading}>
                  {refundSubmitting ? 'Refunding…' : 'Confirm Refund'}
                </button>
              </div>
            </section>
          </div>
        )}
        {toast}
      </ScreenShell>
    );
  }

  const order = mockOrder;
  const releasedPercent = Math.round((order.escrow.released / order.escrow.total) * 100);

  return (
    <ScreenShell
      contentClassName="commission-workspace-content commission-workspace-demo"
      header={
        <div className="px-hd row-between commission-workspace-header">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" />
            <div>
              <div className="t-md fw-700">Order #{order.id}</div>
              <div className="t-xs c-low">{order.startedLabel}</div>
            </div>
          </div>
          <OptionsMenu
            ariaLabel="More options"
            items={[
              { label: 'Message client', onClick: () => navigate('/chat') },
              { label: 'Report an issue', onClick: () => showToast('Issue reported (mock)') },
            ]}
          />
        </div>
      }
    >
      <button
        type="button"
        className="tap-card row-between card workspace-summary-card workspace-counterparty ag-liquid-glass-soft"
        style={{ marginBottom: 16, padding: '12px 16px' }}
        onClick={() => navigate('/chat')}
      >
        <div className="row gap-10">
          <div className="avatar avatar-sm">{order.clientInitials}</div>
          <div style={{ textAlign: 'left' }}>
            <div className="t-sm fw-700">{order.clientName}</div>
            <div className="t-xs c-low">Client</div>
          </div>
        </div>
        <span className="icon-btn" style={{ width: 32, height: 32 }}>
          <Icon name="chat" style={{ width: 15, height: 15 }} />
        </span>
      </button>

      <div className="section-title workspace-milestone-heading" style={{ marginBottom: 16 }}>
        Milestone Progress
      </div>
      <div className="workspace-milestone-list" style={{ position: 'relative', paddingLeft: 4, marginBottom: 22 }}>
        <div
          className="workspace-milestone-track"
          style={{
            position: 'absolute',
            left: 13,
            top: 8,
            bottom: 8,
            width: 2,
            background: 'var(--ag-border-soft)',
          }}
        />
        <div
          className="workspace-milestone-progress-track"
          style={{
            position: 'absolute',
            left: 13,
            top: 8,
            height: `${order.progress}%`,
            width: 2,
            background: 'var(--ag-grad-accent)',
          }}
        />
        <div className="workspace-milestone-items" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {order.milestones.map((m) => (
            <div className="row gap-12 workspace-milestone-item" key={m.name}>
              <div
                className="workspace-milestone-dot"
                data-status={m.status}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  zIndex: 1,
                  ...STATUS_DOT_STYLE[m.status],
                }}
              >
                {m.status === 'approved' && <Icon name="check-circle" style={{ width: 14, height: 14, stroke: '#08110c' }} />}
                {m.status === 'in-progress' && (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ag-ink)' }} />
                )}
              </div>
              <div>
                <div className={`t-sm fw-700${m.status === 'pending' ? ' c-low' : ''}`}>{m.name}</div>
                <div className={`t-xs${m.status === 'in-progress' ? ' c-accent' : ' c-low'}`}>{m.note}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card workspace-payment-card ag-liquid-glass-soft" style={{ marginBottom: 16 }}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="section-title">Escrow Status</span>
          <span className="badge badge-success">Secured</span>
        </div>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <span className="t-xs c-low">Total order value</span>
          <span className="mono fw-700">₱{order.escrow.total.toFixed(2)}</span>
        </div>
        <div style={{ marginBottom: 8 }}>
          <ProgressBar percent={releasedPercent} color="var(--ag-success)" />
        </div>
        <div className="row-between">
          <span className="t-xs c-low">Released ₱{order.escrow.released.toFixed(2)}</span>
          <span className="t-xs c-low">Held ₱{order.escrow.held.toFixed(2)}</span>
        </div>
        <hr className="soft" />
        <p className="t-xs c-low">Funds release automatically when each milestone is approved.</p>
      </div>

      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">Client Requirements</span>
      </div>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        {order.requirementTiles.map((variant, i) => (
          <ArtTile key={i} variant={variant} size={56} locked={false} />
        ))}
      </div>
      <p className="t-xs c-mid" style={{ lineHeight: 1.6, marginBottom: 20 }}>
        &ldquo;{order.requirementsText}&rdquo;
      </p>

      <RevisionRequests orderRef={order.id} orderTitle={order.title} />

      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginBottom: 14 }}
        onClick={() => showToast('Milestone artwork uploaded (mock) — shielding applied')}
      >
        <Icon name="upload" style={{ width: 16, height: 16 }} />
        Upload Milestone Artwork
      </button>
      {toast}
    </ScreenShell>
  );
}
