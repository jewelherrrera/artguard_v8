import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { useMockToast } from '../components/ui/MockToast';
import { isSupabaseConfigured } from '../lib/supabase';
import './ArtistCommissionServicesPage.css';
import {
  createArtistCommissionService,
  listMyArtistCommissionServices,
  setArtistCommissionServiceActive,
  updateArtistCommissionService,
  type ArtistCommissionService,
} from '../lib/supabaseArtistServices';

interface ServiceForm {
  name: string;
  description: string;
  price: string;
  currency: string;
  turnaroundDays: string;
}

const EMPTY_FORM: ServiceForm = {
  name: '',
  description: '',
  price: '',
  currency: 'PHP',
  turnaroundDays: '',
};

function formFromService(service: ArtistCommissionService): ServiceForm {
  return {
    name: service.name,
    description: service.description ?? '',
    price: String(service.price),
    currency: service.currency,
    turnaroundDays: String(service.turnaround_days),
  };
}

export function ArtistCommissionServicesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast, showToast } = useMockToast();
  const [services, setServices] = useState<ArtistCommissionService[]>([]);
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  const loadServices = async () => {
    if (!isSupabaseConfigured || user?.role !== 'artist') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      setServices(await listMyArtistCommissionServices());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load commission services.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadServices();
  }, [user?.role]);

  const updateForm = (field: keyof ServiceForm, value: string) => {
    setForm((current) => ({ ...current, [field]: field === 'currency' ? value.toUpperCase() : value }));
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    const price = Number(form.price);
    const turnaroundDays = Number(form.turnaroundDays);
    if (!form.name.trim()) {
      setError('Service name is required.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('Price must be zero or greater.');
      return;
    }
    if (!Number.isInteger(turnaroundDays) || turnaroundDays <= 0) {
      setError('Turnaround must be greater than zero days.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(form.currency.trim().toUpperCase())) {
      setError('Currency must be a three-letter uppercase code.');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateArtistCommissionService({
          serviceId: editingId,
          name: form.name,
          description: form.description,
          price,
          currency: form.currency,
          turnaroundDays,
        });
        setServices((current) => current.map((service) => service.id === updated.id ? updated : service));
        showToast('Service updated');
      } else {
        await createArtistCommissionService({
          name: form.name,
          description: form.description,
          price,
          currency: form.currency,
          turnaroundDays,
        });
        await loadServices();
        showToast('Service added');
      }
      resetForm();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this service.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (service: ArtistCommissionService) => {
    if (busyId) return;
    setBusyId(service.id);
    setError(undefined);
    try {
      const updated = await setArtistCommissionServiceActive(service.id, !service.is_active);
      setServices((current) => current.map((item) => item.id === updated.id ? updated : item));
      showToast(updated.is_active ? 'Service activated' : 'Service deactivated');
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Could not change service availability.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate('/profile/settings')} ariaLabel="Back to Settings" />
            <span className="h-title" style={{ fontSize: 19 }}>Commission Services</span>
          </div>
        </div>
      }
    >
      {!isSupabaseConfigured && <div className="card t-sm c-mid" role="status">Commission services need a connected Supabase project.</div>}
      {isSupabaseConfigured && (
        <>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span className="section-title">My Commission Services</span>
          </div>
          <form className="card" onSubmit={(event) => void handleSubmit(event)} style={{ marginBottom: 18 }}>
            <div className="section-title" style={{ marginBottom: 12 }}>{editingId ? 'Edit Service' : 'Add Service'}</div>
            <label className="field-label" htmlFor="service-name">Name</label>
            <input id="service-name" className="input-field" value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="Character Portrait" style={{ marginBottom: 12 }} />
            <label className="field-label" htmlFor="service-description">Description</label>
            <textarea id="service-description" className="textarea-field" value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="Bust-up digital portrait with simple background." rows={3} style={{ marginBottom: 12 }} />
            <div className="commission-service-price-fields">
              <div>
                <label className="field-label" htmlFor="service-price">Price</label>
                <input id="service-price" className="input-field" type="number" min="0" step="0.01" value={form.price} onChange={(event) => updateForm('price', event.target.value)} placeholder="2500" />
              </div>
              <div>
                <label className="field-label" htmlFor="service-currency">Currency</label>
                <input id="service-currency" className="input-field" maxLength={3} value={form.currency} onChange={(event) => updateForm('currency', event.target.value)} placeholder="PHP" />
              </div>
            </div>
            <label className="field-label" htmlFor="service-turnaround" style={{ marginTop: 12 }}>Turnaround Days</label>
            <input id="service-turnaround" className="input-field" type="number" min="1" step="1" value={form.turnaroundDays} onChange={(event) => updateForm('turnaroundDays', event.target.value)} placeholder="7" style={{ marginBottom: 12 }} />
            {error && <div className="field-error" role="alert" style={{ marginBottom: 12 }}><Icon name="alert" style={{ width: 13, height: 13 }} />{error}</div>}
            <div className="row gap-10">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Service'}</button>
              {editingId && <button type="button" className="btn btn-ghost" onClick={resetForm} disabled={saving}>Cancel</button>}
            </div>
          </form>

          {loading && <div className="card t-sm c-low" role="status">Loading services…</div>}
          {!loading && !error && services.length === 0 && <div className="card t-sm c-mid">No commission services yet.</div>}
          {!loading && services.map((service) => (
            <article className="card" key={service.id} style={{ marginBottom: 10 }}>
              <div className="row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="t-sm fw-700">{service.name}</div>
                  <div className="t-xs c-low" style={{ marginTop: 3 }}>{service.currency} {service.price.toFixed(2)} · {service.turnaround_days} day{service.turnaround_days === 1 ? '' : 's'}</div>
                </div>
                <span className={`badge ${service.is_active ? 'badge-success' : 'badge-warning'}`}>{service.is_active ? 'ACTIVE' : 'INACTIVE'}</span>
              </div>
              {service.description && <div className="t-xs c-mid" style={{ marginTop: 8, lineHeight: 1.5 }}>{service.description}</div>}
              <div className="row gap-10" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditingId(service.id); setForm(formFromService(service)); setError(undefined); }}>Edit</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleToggleActive(service)} disabled={busyId === service.id}>
                  {busyId === service.id ? 'Saving…' : service.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </article>
          ))}
        </>
      )}
      {toast}
    </ScreenShell>
  );
}