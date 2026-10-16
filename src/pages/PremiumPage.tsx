import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';

const FEATURES = [
  { label: 'HD cloaking uploads', free: false, pro: true },
  { label: 'Custom domain portfolio', free: false, pro: true },
  { label: 'Advanced AI shield', free: false, pro: true },
  { label: 'Transaction fee', free: '5%', pro: '0%' },
  { label: 'Priority support', free: false, pro: true },
];

type PremiumStep = 'plans' | 'checkout' | 'success';

/** A local-only subscription journey. No payment details leave the device. */
export function PremiumPage() {
  const navigate = useNavigate();
  const { user, backendMode, enableMockPremium } = useAuth();
  const [step, setStep] = useState<PremiumStep>('plans');
  const [confirming, setConfirming] = useState(false);
  const [availabilityNotice, setAvailabilityNotice] = useState(false);
  const isMockMode = backendMode === 'mock';
  const isPro = !!user?.isPro;

  const confirmUpgrade = async () => {
    if (!isMockMode) return;
    setConfirming(true);
    const result = await enableMockPremium();
    setConfirming(false);
    if (result.success) setStep('success');
  };

  const goBack = () => {
    if (step === 'checkout' || step === 'success') setStep('plans');
    else navigate(-1);
  };

  const title = !isMockMode
    ? 'Premium'
    : step === 'checkout' ? 'Confirm upgrade' : step === 'success' ? 'Welcome to Pro' : isPro ? 'You are on Pro' : 'Go Pro';
  const subtitle = !isMockMode
    ? 'Premium subscriptions are not available yet.'
    : step === 'checkout'
      ? 'Review your mock subscription before confirming.'
      : step === 'success'
        ? 'Your local mock subscription is active on this device.'
        : 'Unlimited protection. Zero platform fees.';

  return (
    <ScreenShell
      header={
        <div className="px-hd" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 4 }}>
            <IconButton icon="chevron-l" onClick={goBack} ariaLabel="Back" />
          </div>
          <div className="icon-btn" style={{ margin: '6px auto 14px', background: 'var(--ag-grad-primary)', border: 'none' }}>
            <Icon name="crown" style={{ width: 17, height: 17, stroke: 'var(--ag-ink)' }} />
          </div>
          <div className="h-title" style={{ fontSize: 21 }}>{title}</div>
          <p className="t-xs c-low" style={{ marginTop: 4 }}>{subtitle}</p>
        </div>
      }
      footer={
        !isMockMode ? (
          <div className="sticky-action-bar">
            <button type="button" className="btn btn-secondary" onClick={() => setAvailabilityNotice(true)}>
              Coming Soon
            </button>
            <p className="t-xs c-low" style={{ textAlign: 'center' }}>Subscriptions Unavailable</p>
          </div>
        ) : step === 'checkout' ? (
          <div className="sticky-action-bar">
            <button type="button" className="btn btn-primary" onClick={confirmUpgrade} disabled={confirming}>
              {confirming ? 'Confirming…' : 'Confirm Upgrade'}
            </button>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setStep('plans')} disabled={confirming}>Cancel</button>
          </div>
        ) : step === 'success' || isPro ? (
          <div className="sticky-action-bar">
            <button type="button" className="btn btn-primary" onClick={() => navigate('/profile')}>Back to Profile</button>
          </div>
        ) : (
          <div className="sticky-action-bar">
            <button type="button" className="btn btn-primary" onClick={() => setStep('checkout')}>
              <Icon name="zap" style={{ width: 16, height: 16, stroke: 'var(--ag-ink)' }} />
              Upgrade to Pro — ₱12/mo
            </button>
            <p className="t-xs c-low" style={{ textAlign: 'center' }}>Cancel anytime · Billed monthly</p>
          </div>
        )
      }
    >
      {isMockMode && step === 'checkout' ? (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="row-between" style={{ marginBottom: 16 }}>
            <div><div className="t-sm fw-700">ArtGuard Pro</div><div className="t-xs c-low">Monthly subscription</div></div>
            <div className="mono fw-700 c-accent">₱12/month</div>
          </div>
          <hr className="soft" />
          <div className="t-xs c-low" style={{ marginBottom: 7 }}>Payment method</div>
          <div className="input-field" aria-label="Mock payment method">
            <Icon name="lock" style={{ width: 16, height: 16 }} />
            <span className="t-sm c-mid">Payment method placeholder</span>
          </div>
          <p className="t-xs c-low" style={{ lineHeight: 1.55, margin: '14px 0 0' }}>
            This is a local development preview. No card details are collected and no payment will be made.
          </p>
        </div>
      ) : isMockMode && step === 'success' ? (
        <div className="card" style={{ textAlign: 'center', marginTop: 8 }}>
          <Icon name="check-circle" style={{ width: 42, height: 42, stroke: 'var(--ag-success)', marginBottom: 12 }} />
          <div className="section-title">You&apos;re now on Pro</div>
          <p className="t-xs c-mid" style={{ lineHeight: 1.6, margin: '8px 0 0' }}>
            Your mock Pro status is saved locally and will remain active while you develop this app.
          </p>
        </div>
      ) : (
        <>
          <div className="row gap-10" style={{ marginBottom: 16 }}>
            <div className="card" style={{ flex: 1, padding: '16px 14px' }}>
              <div className="t-xs c-low" style={{ marginBottom: 2 }}>Free</div>
              <div className="mono fw-700" style={{ fontSize: 20, marginBottom: 10 }}>₱0</div>
              <div className="t-xs c-low">5% transaction fee</div>
            </div>
            <div className="card" style={{ flex: 1, padding: '16px 14px', background: 'var(--ag-grad-primary)', border: 'none', position: 'relative' }}>
              <span className="badge" style={{ position: 'absolute', top: -9, right: 12, background: 'var(--ag-ink)', color: 'var(--ag-accent-soft)' }}>POPULAR</span>
              <div className="t-xs" style={{ color: 'rgba(22,33,59,0.75)', marginBottom: 2 }}>Pro</div>
              <div className="mono fw-700" style={{ fontSize: 20, color: 'var(--ag-ink)', marginBottom: 10 }}>₱12<span style={{ fontSize: 12, fontWeight: 500 }}>/mo</span></div>
              <div className="t-xs" style={{ color: 'rgba(22,33,59,0.75)' }}>0% transaction fee</div>
            </div>
          </div>
          <div className="section-title" style={{ marginBottom: 10 }}>What&apos;s included</div>
          <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 16 }}>
            {FEATURES.map((feature, i) => (
              <div className="row-between" key={feature.label} style={{ padding: '11px 0', borderBottom: i === FEATURES.length - 1 ? 'none' : '1px solid var(--ag-border-soft)' }}>
                <span className="t-xs c-mid">{feature.label}</span>
                {typeof feature.free === 'boolean' ? (
                  <div className="row gap-14"><Icon name="x" style={{ width: 14, height: 14, stroke: 'var(--ag-text-low)' }} /><Icon name="check-circle" style={{ width: 14, height: 14, stroke: 'var(--ag-success)' }} /></div>
                ) : (
                  <div className="row gap-14"><span className="t-xs c-low mono">{feature.free}</span><span className="t-xs c-success mono fw-700">{feature.pro}</span></div>
                )}
              </div>
            ))}
          </div>
          {!isMockMode && availabilityNotice && (
            <div className="card t-xs c-mid" role="status" style={{ marginBottom: 16 }}>
              Premium subscriptions are not available yet. Subscription billing and verified Premium entitlements are not connected.
            </div>
          )}
        </>
      )}
    </ScreenShell>
  );
}
