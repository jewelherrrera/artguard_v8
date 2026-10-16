import type { UserRole } from '../../types/auth';

interface RoleToggleProps {
  value: UserRole;
  onChange: (role: UserRole) => void;
}

const OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'artist', label: "I'm an Artist" },
  { value: 'client', label: "I'm a Client" },
];

/** Interactive version of the mockup's role pill switch (was static markup there). */
export function RoleToggle({ value, onChange }: RoleToggleProps) {
  return (
    <div
      className="row gap-8"
      style={{ background: 'var(--ag-surface-2)', padding: 4, borderRadius: 'var(--ag-r-full)', marginBottom: 22 }}
      role="tablist"
      aria-label="Account type"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: 9,
              borderRadius: 'var(--ag-r-full)',
              fontSize: 12.5,
              fontWeight: active ? 700 : 600,
              background: active ? 'var(--ag-grad-primary)' : 'transparent',
              color: active ? 'var(--ag-ink)' : 'var(--ag-text-low)',
              border: 'none',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
