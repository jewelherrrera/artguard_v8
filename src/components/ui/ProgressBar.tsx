interface ProgressBarProps {
  /** 0–100 */
  percent: number;
  color?: string;
}

export function ProgressBar({ percent, color }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="progress-track" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${clamped}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}
