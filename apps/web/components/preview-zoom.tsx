import { MAX_PREVIEW_SCALE, pinchPoints, previewScale, zoomScroll, type Point } from '@/lib/preview-zoom';
import { listenPreviewInput, type PreviewInput } from '@/lib/preview-input';
import { RotateCwIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react-native';
import * as React from 'react';

type ZoomState = {
  scale: number;
  width: number;
  height: number;
  rotation: number;
  viewport: React.RefObject<HTMLDivElement | null>;
  bindFrame: (frame: HTMLIFrameElement, token: string) => () => void;
};
const ZoomContext = React.createContext<ZoomState | null>(null);
export function usePreviewZoom() {
  const value = React.useContext(ZoomContext);
  if (!value) throw new Error('Preview content must be inside PreviewZoom');
  return value;
}

/** One gesture and scroll surface for every zoomable attachment, at either dialog size. */
export function PreviewZoom({ children, image = false }: { children: React.ReactNode; image?: boolean }) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const extent = React.useRef<HTMLDivElement>(null);
  const scaleRef = React.useRef(1);
  const activeFrame = React.useRef<{ frame: HTMLIFrameElement; token: string } | null>(null);
  const [scale, setScale] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  const measure = React.useCallback(() => {
    const el = viewport.current, body = content.current, box = extent.current;
    if (!el || !body || !box) return;
    box.style.width = `${Math.max(body.offsetWidth, body.scrollWidth) * scaleRef.current}px`;
    box.style.height = `${Math.max(el.clientHeight, body.offsetHeight) * scaleRef.current}px`;
  }, []);
  const zoom = React.useCallback((value: number, anchor?: Point) => {
    const el = viewport.current, body = content.current;
    if (!el || !body) return;
    const next = previewScale(value);
    const scroll = zoomScroll({ x: el.scrollLeft, y: el.scrollTop }, scaleRef.current, next,
      anchor ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 });
    scaleRef.current = next;
    // Update the scroll extent before setting scrollLeft/Top, including during fast pinches.
    body.style.transform = `scale(${next})`;
    measure();
    el.scrollLeft = scroll.x;
    el.scrollTop = scroll.y;
    setScale(next);
  }, [measure]);
  const reset = React.useCallback(() => {
    zoom(1, { x: 0, y: 0 });
    viewport.current?.scrollTo(0, 0);
    const active = activeFrame.current;
    active?.frame.contentWindow?.postMessage({ token: active.token, type: 'reset' }, '*');
    setRotation(0);
  }, [zoom]);

  React.useLayoutEffect(() => {
    const el = viewport.current, body = content.current;
    if (!el || !body) return;
    const observer = new ResizeObserver(() => {
      setSize((old) => old.width === el.clientWidth && old.height === el.clientHeight ? old : { width: el.clientWidth, height: el.clientHeight });
      measure();
    });
    observer.observe(el);
    observer.observe(body);
    return () => observer.disconnect();
  }, [measure]);

  const inputHandler = React.useCallback((point: (x: number, y: number) => Point, overflowScroll?: (x: number, y: number) => void) => {
    let touches: (ReturnType<typeof pinchPoints> & { anchor: Point }) | null = null;
    let touchCount = 0;
    let safariScale: number | null = null;
    let safariAnchor: Point | undefined;
    const pan = (x: number, y: number) => {
      const el = viewport.current;
      if (!el) return;
      const beforeX = el.scrollLeft, beforeY = el.scrollTop;
      el.scrollBy(x, y);
      overflowScroll?.((x - el.scrollLeft + beforeX) / scaleRef.current, (y - el.scrollTop + beforeY) / scaleRef.current);
    };
    return (input: PreviewInput) => {
      if (input.type === 'wheel') {
        const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? viewport.current?.clientHeight ?? 600 : 1;
        if (input.ctrlKey) {
          if (safariScale === null) zoom(scaleRef.current * Math.exp(-input.deltaY * unit * 0.01), point(input.x, input.y));
        } else {
          pan(input.shiftKey ? (input.deltaX || input.deltaY) * unit : input.deltaX * unit, input.shiftKey ? 0 : input.deltaY * unit);
        }
      } else if ('points' in input) {
        if (!input.points.length || input.type === 'touchcancel') { touches = null; touchCount = 0; return; }
        // Screen coordinates stay stable while the frame transform changes. Frame messages
        // are asynchronous, so mapping every move with the latest scale would cause drift.
        const next = pinchPoints(input.points.map((p) => ({ x: p.screenX, y: p.screenY })));
        const local = pinchPoints(input.points).center;
        let anchor = point(local.x, local.y);
        if (touches && touchCount === input.points.length && input.type === 'touchmove') {
          const dx = touches.center.x - next.center.x, dy = touches.center.y - next.center.y;
          if (input.points.length > 1 && touches.distance > 0) zoom(scaleRef.current * next.distance / touches.distance, touches.anchor);
          pan(dx, dy);
          anchor = { x: touches.anchor.x - dx, y: touches.anchor.y - dy };
        }
        touches = { ...next, anchor };
        touchCount = input.points.length;
      } else if (input.type === 'keydown') {
        if (input.key === '+' || input.key === '=') zoom(scaleRef.current * 1.25);
        else if (input.key === '-') zoom(scaleRef.current / 1.25);
        else if (input.key === '0') reset();
      } else {
        if (input.type === 'gestureend') { safariScale = null; return; }
        if (touchCount > 1) return; // iOS also emits touch events. Handle each pinch once.
        if (input.type === 'gesturestart') { safariScale = scaleRef.current; safariAnchor = point(input.x, input.y); }
        else if (safariScale !== null) zoom(safariScale * input.scale, safariAnchor);
      }
    };
  }, [reset, zoom]);

  React.useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    return listenPreviewInput(el, inputHandler((x, y) => {
      const rect = el.getBoundingClientRect();
      return { x: x - rect.left, y: y - rect.top };
    }));
  }, [inputHandler]);

  const bindFrame = React.useCallback((frame: HTMLIFrameElement, token: string) => {
    const el = viewport.current;
    if (!el) return () => {};
    activeFrame.current = { frame, token };
    const handle = inputHandler((x, y) => {
      const rect = frame.getBoundingClientRect(), outer = el.getBoundingClientRect();
      return { x: rect.left - outer.left + x * scaleRef.current, y: rect.top - outer.top + y * scaleRef.current };
    }, (x, y) => { frame.contentWindow?.postMessage({ token, type: 'scroll', x, y }, '*'); });
    frame.style.width = '100%';
    frame.style.height = `${el.clientHeight}px`;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token) return;
      const message = event.data.message;
      if (message?.type === 'input') handle(message.input);
      else if (message?.type === 'size' && Number.isFinite(message.width) && Number.isFinite(message.height)) {
        frame.style.width = `${Math.max(el.clientWidth, message.width)}px`;
        frame.style.height = `${Math.max(el.clientHeight, message.height)}px`;
        measure();
      }
    };
    window.addEventListener('message', receive);
    frame.contentWindow?.postMessage({ token, type: 'measure', width: el.clientWidth, height: el.clientHeight }, '*');
    return () => {
      window.removeEventListener('message', receive);
      if (activeFrame.current?.frame === frame) activeFrame.current = null;
    };
  }, [inputHandler, measure]);

  const drag = React.useRef<Point | null>(null);
  return <ZoomContext.Provider value={{ scale, ...size, rotation, viewport, bindFrame }}>
    <div className="relative h-full w-full overflow-hidden" data-testid="preview-zoom" data-scale={scale}>
      <div ref={viewport} tabIndex={0} role="region" aria-label="File preview. Pinch to zoom."
        className="absolute inset-0 overflow-auto outline-none" style={{ touchAction: 'none', overscrollBehavior: 'contain', cursor: image && scale > 1 ? 'grab' : undefined }}
        onPointerDown={(event) => {
          if (!image || event.pointerType !== 'mouse' || event.button !== 0 || scale <= 1) return;
          drag.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          event.currentTarget.scrollBy(drag.current.x - event.clientX, drag.current.y - event.clientY);
          drag.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={image ? () => scaleRef.current > 1 ? reset() : zoom(2) : undefined}>
        <div ref={extent} className="relative">
          <div ref={content} className="absolute left-0 top-0 origin-top-left" style={{ width: size.width || '100%', minHeight: size.height }}>
            {size.width > 0 ? children : null}
          </div>
        </div>
      </div>
      <div role="toolbar" aria-label="Preview zoom" className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/80 px-2 py-1 text-white shadow-lg">
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={scale <= 1} onClick={() => zoom(scaleRef.current / 1.25)} className="rounded-full p-2 hover:bg-white/15 disabled:opacity-40"><ZoomOutIcon size={16} color="#fff" /></button>
        <button type="button" aria-label="Reset zoom" title="Reset zoom (0)" onClick={reset} className="min-w-14 rounded-full px-1 py-1 text-xs tabular-nums hover:bg-white/15">{Math.round(scale * 100)}%</button>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={scale >= MAX_PREVIEW_SCALE} onClick={() => zoom(scaleRef.current * 1.25)} className="rounded-full p-2 hover:bg-white/15 disabled:opacity-40"><ZoomInIcon size={16} color="#fff" /></button>
        {image ? <button type="button" aria-label="Rotate 90°" title="Rotate 90°" onClick={() => setRotation((value) => (value + 90) % 360)} className="rounded-full p-2 hover:bg-white/15"><RotateCwIcon size={16} color="#fff" /></button> : null}
      </div>
    </div>
  </ZoomContext.Provider>;
}
