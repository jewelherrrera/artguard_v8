import type { FormEvent } from 'react';
import type { CommissionPost, CommissionPostInput } from '../lib/supabaseCommissionPosts';

export interface CommissionPostDraft {
  title: string;
  description: string;
  budgetMin: string;
  budgetMax: string;
  currency: string;
}

export const EMPTY_COMMISSION_POST_DRAFT: CommissionPostDraft = {
  title: '',
  description: '',
  budgetMin: '',
  budgetMax: '',
  currency: '',
};

export function commissionPostDraftFromPost(post: CommissionPost): CommissionPostDraft {
  return {
    title: post.title,
    description: post.description,
    budgetMin: post.budget_min === null ? '' : String(post.budget_min),
    budgetMax: post.budget_max === null ? '' : String(post.budget_max),
    currency: post.currency ?? '',
  };
}

export function validateCommissionPostDraft(form: CommissionPostDraft): CommissionPostInput | string {
  const title = form.title.trim();
  const description = form.description.trim();
  if (!title) return 'Title is required.';
  if (!description) return 'Description is required.';

  const parseBudget = (value: string, label: string): number | null | string => {
    if (!value.trim()) return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : `${label} must be greater than zero.`;
  };

  const budgetMin = parseBudget(form.budgetMin, 'Minimum budget');
  if (typeof budgetMin === 'string') return budgetMin;
  const budgetMax = parseBudget(form.budgetMax, 'Maximum budget');
  if (typeof budgetMax === 'string') return budgetMax;
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
    return 'Minimum budget cannot exceed maximum budget.';
  }

  const currency = form.currency.trim().toUpperCase() || null;
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) {
    return 'Currency must be a three-letter uppercase code.';
  }

  return { title, description, budgetMin, budgetMax, currency };
}

interface CommissionPostFormProps {
  form: CommissionPostDraft;
  heading: string;
  submitLabel: string;
  error: string | null;
  saving: boolean;
  onChange: (field: keyof CommissionPostDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

export function CommissionPostForm({
  form,
  heading,
  submitLabel,
  error,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: CommissionPostFormProps) {
  return (
    <form onSubmit={onSubmit} className="card commission-post-edit-form" style={{ marginBottom: 14 }}>
      <div className="section-title" style={{ marginBottom: 12 }}>{heading}</div>
      <label className="field-label" htmlFor="public-post-title">Title</label>
      <input
        id="public-post-title"
        className="input-field"
        value={form.title}
        onChange={(event) => onChange('title', event.target.value)}
        required
        style={{ marginBottom: 12 }}
      />
      <label className="field-label" htmlFor="public-post-description">Description</label>
      <textarea
        id="public-post-description"
        className="textarea-field"
        value={form.description}
        onChange={(event) => onChange('description', event.target.value)}
        required
        rows={4}
        style={{ marginBottom: 12 }}
      />
      <div className="row gap-10">
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="public-post-budget-min">Minimum Budget</label>
          <input
            id="public-post-budget-min"
            className="input-field"
            type="number"
            min="0.01"
            step="0.01"
            value={form.budgetMin}
            onChange={(event) => onChange('budgetMin', event.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="public-post-budget-max">Maximum Budget</label>
          <input
            id="public-post-budget-max"
            className="input-field"
            type="number"
            min="0.01"
            step="0.01"
            value={form.budgetMax}
            onChange={(event) => onChange('budgetMax', event.target.value)}
          />
        </div>
      </div>
      <label className="field-label" htmlFor="public-post-currency" style={{ marginTop: 12 }}>Currency</label>
      <input
        id="public-post-currency"
        className="input-field"
        maxLength={3}
        value={form.currency}
        onChange={(event) => onChange('currency', event.target.value.toUpperCase())}
        placeholder="USD"
        style={{ marginBottom: 12 }}
      />
      {error && <div className="field-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="row gap-10">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
