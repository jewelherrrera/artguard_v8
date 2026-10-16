import type { ReactNode, CSSProperties } from 'react';
import { IonSpinner } from '@ionic/react';

interface AuthButtonProps {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}

export function AuthButton({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: AuthButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}`}
      onClick={onClick}
      disabled={disabled || loading}
      style={style}
    >
      {loading ? <IonSpinner name="crescent" style={{ width: 18, height: 18 }} /> : children}
    </button>
  );
}
