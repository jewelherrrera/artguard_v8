import { useId, useState } from 'react';
import { Icon, type IconName } from '../../assets/icons';

interface AuthInputProps {
  label: string;
  icon: IconName;
  type?: 'text' | 'email' | 'password' | 'date';
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  error?: string;
  autoComplete?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  max?: string;
}

/**
 * Real, fully editable input styled to match the mockup's `.input-field`
 * exactly (icon on the left, gold focus ring, red error ring). Users can
 * type, delete, select, and replace text like any native input — the
 * mockup's `readonly` placeholder inputs are not carried over.
 */
export function AuthInput({
  label,
  icon,
  type = 'text',
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  autoComplete,
  name,
  disabled,
  required,
  max,
}: AuthInputProps) {
  const inputId = useId();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const isPassword = type === 'password';
  const resolvedType = isPassword ? (revealed ? 'text' : 'password') : type;

  const fieldClassName = ['input-field', focused ? 'is-focused' : '', error ? 'is-error' : ''].filter(Boolean).join(' ');

  return (
    <div style={{ marginBottom: 14 }}>
      <label className="field-label" htmlFor={inputId}>
        {label}
      </label>
      <div className={fieldClassName}>
        <Icon name={icon} style={{ width: 16, height: 16, stroke: 'var(--ag-text-low)' }} />
        <input
          id={inputId}
          name={name}
          type={resolvedType}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          required={required}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        {isPassword && (
          <button
            type="button"
            className="eye-toggle"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            tabIndex={0}
          >
            <Icon name={revealed ? 'eye-off' : 'eye'} style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>
      {error && (
        <div className="field-error" id={`${inputId}-error`} role="alert">
          <Icon name="alert" style={{ width: 12, height: 12, stroke: 'var(--ag-danger)' }} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
