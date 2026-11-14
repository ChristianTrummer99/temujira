import type { Point } from './preview-zoom';

export type PreviewInput =
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey: boolean }
  | { type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel'; points: (Point & { screenX: number; screenY: number })[] }
  | { type: 'gesturestart' | 'gesturechange' | 'gestureend'; x: number; y: number; scale: number }
  | { type: 'keydown'; key: string };

/** This function is also sent to the isolated frame. Keep it free of outside references. */
export function listenPreviewInput(target: HTMLElement | Document, send: (input: PreviewInput) => void, inFrame = false) {
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !inFrame) return; // Keep normal scrolling native.
    event.preventDefault();
    send({ type: 'wheel', x: event.clientX, y: event.clientY, deltaX: event.deltaX, deltaY: event.deltaY,
      deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
  };
  const touch = (event: TouchEvent) => {
    // Keep taps and long-press text selection available.
    if (event.cancelable && (event.touches.length > 1 || event.type === 'touchmove')) event.preventDefault();
    send({ type: event.type as 'touchmove', points: Array.from(event.touches, (t) => ({ x: t.clientX, y: t.clientY, screenX: t.screenX, screenY: t.screenY })) });
  };
  const gesture = (event: Event & { scale: number; clientX: number; clientY: number }) => {
    event.preventDefault();
    send({ type: event.type as 'gesturechange', x: event.clientX, y: event.clientY, scale: event.scale });
  };
  const key = (event: KeyboardEvent) => {
    const node = event.target as HTMLElement | null;
    if (event.ctrlKey || event.metaKey || event.altKey || node?.closest('input,textarea,select,[contenteditable]')) return;
    if (!['+', '=', '-', '0'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    send({ type: 'keydown', key: event.key });
  };
  const listeners: [string, EventListener][] = [
    ['wheel', wheel as EventListener], ['keydown', key as EventListener],
    ['touchstart', touch as EventListener], ['touchmove', touch as EventListener],
    ['touchend', touch as EventListener], ['touchcancel', touch as EventListener],
    ['gesturestart', gesture as EventListener], ['gesturechange', gesture as EventListener], ['gestureend', gesture as EventListener],
  ];
  listeners.forEach((entry) => target.addEventListener(entry[0], entry[1], { passive: false }));
  return () => { listeners.forEach((entry) => target.removeEventListener(entry[0], entry[1])); };
}

/** Trusted frame bridge. Only this nonce-protected script can run in an uploaded page. */
export function previewFrameBridge(token: string, listen: typeof listenPreviewInput) {
  const send = (message: object) => parent.postMessage({ token, message }, '*');
  listen(document, (input) => send({ type: 'input', input }), true);
  let baseWidth = innerWidth, baseHeight = innerHeight;
  let lastWidth = innerWidth, lastHeight = innerHeight;
  let lastContentWidth = 0, lastContentHeight = 0;
  let fixedViewport = false;
  const measure = () => {
    if (!document.body) return;
    const width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    // A page with vh/vw layout can grow every time its frame grows. Keep that page's
    // viewport fixed and scroll inside it after the outer surface reaches its edge.
    if ((lastContentWidth > 0 && innerWidth > lastWidth && width > lastContentWidth + 1) ||
        (lastContentHeight > 0 && innerHeight > lastHeight && height > lastContentHeight + 1)) fixedViewport = true;
    lastWidth = innerWidth; lastHeight = innerHeight;
    lastContentWidth = width; lastContentHeight = height;
    send({ type: 'size', width: fixedViewport ? baseWidth : width, height: fixedViewport ? baseHeight : height });
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.touchAction = 'none';
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    measure();
  });
  window.addEventListener('resize', measure);
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.token !== token) return;
    if (event.data.type === 'measure') {
      baseWidth = event.data.width; baseHeight = event.data.height;
      measure();
    } else if (event.data.type === 'scroll') window.scrollBy(event.data.x, event.data.y);
    else if (event.data.type === 'reset') window.scrollTo(0, 0);
  });
}
