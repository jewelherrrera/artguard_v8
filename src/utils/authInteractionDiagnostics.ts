export const AUTH_INTERACTION_DIAGNOSTICS_FLAG = 'ag.authInteractionDiagnostics';

type DiagnosticValue = string | number | boolean | null | undefined;
type DiagnosticDetails = Record<string, DiagnosticValue>;
type DiagnosticAuthState = {
  initializing: boolean;
  hasUser: boolean;
  isAuthenticated: boolean;
  supabaseConfigured: boolean;
};

type ElementSummary = {
  tag: string;
  className: string;
  role: string | null;
  pointerEvents: string;
  display: string;
  visibility: string;
  zIndex: string;
  disabled: boolean;
  inHiddenIonicPage: boolean;
  inActiveVisibleIonicPage: boolean;
};

type AuthInteractionSnapshot = {
  enabled: boolean;
  timestamp: string;
  pathname: string;
  auth: DiagnosticAuthState | null;
  activeVisibleIonicPageCount: number;
  activeIonicPages: ElementSummary[];
  activeOverlayCount: number;
  activeOverlays: ElementSummary[];
  topmostAtCenter: ElementSummary | null;
};

declare global {
  interface Window {
    __agAuthInteractionSnapshot?: () => AuthInteractionSnapshot;
  }
}

const SAFE_DETAIL_KEYS = new Set([
  'activeOverlayCount',
  'activeVisibleIonicPageCount',
  'destination',
  'eventType',
  'expectedDestinationReached',
  'hasUser',
  'initializing',
  'isAuthenticated',
  'navigationMechanism',
  'reason',
  'success',
  'supabaseConfigured',
  'targetDisabled',
  'targetInActiveVisibleIonicPage',
  'targetInHiddenIonicPage',
  'topmostIsOverlay',
  'topmostRelatedToTarget',
]);

const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'ion-button',
  'ion-item',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[aria-pressed]',
  '[tabindex]',
  '.tap-card',
].join(', ');
const OVERLAY_SELECTOR = [
  'ion-modal',
  'ion-alert',
  'ion-action-sheet',
  'ion-popover',
  'ion-loading',
  'ion-backdrop',
  '[role="dialog"]',
  '.account-dialog-backdrop',
  '.protected-artwork-modal-backdrop',
  '.chat-lightbox-overlay',
  '.chat-composer-sheet',
].join(', ');

let currentAuthState: DiagnosticAuthState | null = null;
let expectedDestination: string | null = null;

function diagnosticsEnabled(): boolean {
  try {
    return typeof window !== 'undefined'
      && ['1', 'true', 'on'].includes(window.localStorage.getItem(AUTH_INTERACTION_DIAGNOSTICS_FLAG)?.toLowerCase() ?? '');
  } catch {
    return false;
  }
}

function safePathname(pathname: string): string {
  const sensitiveRouteSegments = new Set(['artist', 'artwork', 'client', 'workspace', 'chat', 'user']);
  const segments = pathname.split('/');
  return segments.map((segment, index) => {
    if (!segment) return segment;
    if (sensitiveRouteSegments.has(segments[index - 1]?.toLowerCase())) return ':id';
    if (/^[\da-f]{8}-[\da-f-]{27,}$/i.test(segment) || /^\d{6,}$/.test(segment)) return ':id';
    return segment;
  }).join('/');
}

function safeString(value: string): string {
  return value
    .replace(/[^\w./:-]/g, '')
    .replace(/[\da-f]{8}-[\da-f-]{27,}/ig, ':id')
    .slice(0, 120);
}

function safeDetails(details: DiagnosticDetails): DiagnosticDetails {
  return Object.fromEntries(Object.entries(details)
    .filter(([key, value]) => SAFE_DETAIL_KEYS.has(key) && value !== undefined)
    .map(([key, value]) => [key, typeof value === 'string' ? safeString(value) : value]));
}

function diagnosticContext(): Record<string, DiagnosticValue> {
  return {
    timestamp: new Date().toISOString(),
    pathname: typeof window === 'undefined' ? '' : safePathname(window.location.pathname),
    ...currentAuthState,
  };
}

export function updateAuthInteractionDiagnosticState(state: DiagnosticAuthState): void {
  if (!diagnosticsEnabled()) return;
  currentAuthState = state;
}

export function logAuthInteractionDiagnostic(event: string, details: DiagnosticDetails = {}): void {
  if (!diagnosticsEnabled()) return;
  console.info('[AG AuthDiag]', {
    event: safeString(event),
    ...diagnosticContext(),
    ...safeDetails(details),
  });
}

export function recordAuthDiagnosticNavigation(destination: string, navigationMechanism: string): void {
  if (!diagnosticsEnabled()) return;
  expectedDestination = safePathname(destination);
  logAuthInteractionDiagnostic('navigation.started', {
    destination: expectedDestination,
    navigationMechanism,
  });
}

export function recordAuthDiagnosticDestinationReached(destination: string): void {
  if (!diagnosticsEnabled()) return;
  const safeDestination = safePathname(destination);
  const expectedDestinationReached = expectedDestination === safeDestination;
  logAuthInteractionDiagnostic('navigation.destination-reached', {
    destination: safeDestination,
    expectedDestinationReached,
  });
  if (expectedDestinationReached) expectedDestination = null;
}

function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity) !== 0
    && rect.width > 0
    && rect.height > 0;
}

function safeClassName(element: Element): string {
  return [...element.classList]
    .map((className) => className.replace(/[^\w-]/g, '').slice(0, 32))
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}

function safeRole(element: Element): string | null {
  const role = element.getAttribute('role')?.toLowerCase();
  const allowedRoles = new Set(['button', 'link', 'tab', 'navigation', 'dialog', 'alert', 'status', 'menu', 'menuitem', 'switch', 'checkbox', 'radio', 'img', 'textbox', 'combobox']);
  return role && allowedRoles.has(role) ? role : null;
}

function summarizeElement(element: Element | null): ElementSummary | null {
  if (!element) return null;
  const style = window.getComputedStyle(element);
  const page = element.closest('.ion-page');
  const inHiddenIonicPage = Boolean(page?.classList.contains('ion-page-hidden') || (page && !isVisible(page)));
  const inActiveVisibleIonicPage = Boolean(page && !inHiddenIonicPage);
  const htmlElement = element as HTMLElement;
  return {
    tag: element.tagName.toLowerCase(),
    className: safeClassName(element),
    role: safeRole(element),
    pointerEvents: style.pointerEvents,
    display: style.display,
    visibility: style.visibility,
    zIndex: style.zIndex,
    disabled: 'disabled' in htmlElement && Boolean((htmlElement as HTMLButtonElement).disabled),
    inHiddenIonicPage,
    inActiveVisibleIonicPage,
  };
}

function visibleElements(selector: string): Element[] {
  return [...document.querySelectorAll(selector)].filter(isVisible);
}

function buildSnapshot(x = Math.floor(window.innerWidth / 2), y = Math.floor(window.innerHeight / 2)): AuthInteractionSnapshot {
  const activeIonicPages = visibleElements('.ion-page');
  const activeOverlays = visibleElements(OVERLAY_SELECTOR);
  return {
    enabled: diagnosticsEnabled(),
    timestamp: new Date().toISOString(),
    pathname: safePathname(window.location.pathname),
    auth: currentAuthState,
    activeVisibleIonicPageCount: activeIonicPages.length,
    activeIonicPages: activeIonicPages.slice(0, 6).map((element) => summarizeElement(element)!).filter(Boolean),
    activeOverlayCount: activeOverlays.length,
    activeOverlays: activeOverlays.slice(0, 8).map((element) => summarizeElement(element)!).filter(Boolean),
    topmostAtCenter: summarizeElement(document.elementFromPoint(x, y)),
  };
}

function logInteraction(event: PointerEvent | MouseEvent): void {
  if (!diagnosticsEnabled()) return;
  const target = event.target instanceof Element ? event.target.closest(INTERACTIVE_SELECTOR) : null;
  if (!target) return;

  const topmost = document.elementFromPoint(event.clientX, event.clientY);
  const relatedTopmost = Boolean(topmost && (target === topmost || target.contains(topmost) || topmost.contains(target)));
  const topmostSummary = summarizeElement(topmost);
  const targetSummary = summarizeElement(target);
  const topmostIsOverlay = Boolean(topmost?.matches(OVERLAY_SELECTOR) || topmost?.closest(OVERLAY_SELECTOR));
  const activeVisibleIonicPageCount = visibleElements('.ion-page').length;
  const activeOverlayCount = visibleElements(OVERLAY_SELECTOR).length;
  const reason = relatedTopmost
    ? 'hit-target-matches'
    : topmostIsOverlay
      ? 'possible-overlay-interception'
      : targetSummary?.inHiddenIonicPage
        ? 'target-in-hidden-ionic-page'
        : 'possible-interception';

  logAuthInteractionDiagnostic(`interaction.${event.type}`, {
    destination: safePathname(window.location.pathname),
    activeVisibleIonicPageCount,
    activeOverlayCount,
    reason,
  });
  console.info('[AG AuthDiag]', {
    event: 'interaction.target',
    ...diagnosticContext(),
    eventType: event.type,
    target: summarizeElement(target),
    topmostAtClick: topmostSummary,
    coordinates: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
    topmostRelatedToTarget: relatedTopmost,
    topmostIsOverlay,
    targetDisabled: targetSummary?.disabled ?? false,
    targetInHiddenIonicPage: targetSummary?.inHiddenIonicPage ?? false,
    targetInActiveVisibleIonicPage: targetSummary?.inActiveVisibleIonicPage ?? false,
  });
}

export function installAuthInteractionDiagnostics(): () => void {
  if (!diagnosticsEnabled()) return () => undefined;

  const lastLoggedAt = new Map<string, number>();
  const handleInteraction = (event: Event) => {
    if (!(event instanceof MouseEvent)) return;
    const target = event.target instanceof Element ? event.target.closest(INTERACTIVE_SELECTOR) : null;
    if (!target) return;
    const signature = `${event.type}:${target.tagName}:${safeClassName(target)}`;
    const now = Date.now();
    if (now - (lastLoggedAt.get(signature) ?? 0) < 400) return;
    lastLoggedAt.set(signature, now);
    if (lastLoggedAt.size > 60) {
      for (const [key, timestamp] of lastLoggedAt) {
        if (now - timestamp >= 400) lastLoggedAt.delete(key);
      }
    }
    logInteraction(event);
  };

  const snapshot = () => {
    const result = buildSnapshot();
    if (result.enabled) console.info('[AG AuthDiag]', { event: 'snapshot', ...result });
    return result;
  };

  window.__agAuthInteractionSnapshot = snapshot;
  document.addEventListener('pointerdown', handleInteraction, true);
  document.addEventListener('click', handleInteraction, true);
  logAuthInteractionDiagnostic('diagnostics.enabled');

  return () => {
    document.removeEventListener('pointerdown', handleInteraction, true);
    document.removeEventListener('click', handleInteraction, true);
    if (window.__agAuthInteractionSnapshot === snapshot) {
      delete window.__agAuthInteractionSnapshot;
    }
    lastLoggedAt.clear();
  };
}
