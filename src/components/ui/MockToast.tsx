import { useCallback, useRef, useState } from 'react';

/**
 * Lightweight ephemeral toast for mock/local actions (no real backend calls
 * to confirm). Returns the rendered node plus a `showToast(message)` fn.
 *
 * Usage:
 *   const { toast, showToast } = useMockToast();
 *   <button onClick={() => showToast('Artwork shielded')}>Upload</button>
 *   {toast}
 */
export function useMockToast(durationMs = 2200) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (text: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setMessage(text);
      timerRef.current = setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs]
  );

  const toast = message ? (
    <div className="mock-toast" role="status">
      {message}
    </div>
  ) : null;

  return { toast, showToast };
}
