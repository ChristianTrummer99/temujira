import { loadPdf } from '@/lib/pdf-document';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import * as React from 'react';
import { usePreviewZoom } from './preview-zoom';

/** PDF.js renders pages; the shared preview surface owns all zoom and gestures. */
export function PdfPreview({ url }: { url: string }) {
  const [doc, setDoc] = React.useState<PDFDocumentProxy | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let cancelled = false;
    let loading: ReturnType<typeof import('pdfjs-dist').getDocument> | undefined;
    void loadPdf().then(async (pdf) => {
      if (cancelled) return;
      const assets = `/pdfjs/${pdf.version}/`;
      // PDF.js 6 has no eval renderer. Use only page/text APIs, with no PDF scripting.
      loading = pdf.getDocument({ url, enableXfa: false,
        cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/` });
      const document = await loading.promise;
      if (!cancelled) setDoc(document);
    }).catch((e) => { if (!cancelled) setError(e?.name === 'PasswordException' ? 'This PDF needs a password. Open it in a new tab.' : 'This PDF could not be displayed. You can still download it.'); });
    return () => { cancelled = true; void loading?.destroy(); };
  }, [url]);
  if (error) return <p role="alert" className="p-6 text-sm">{error}</p>;
  if (!doc) return <p role="status" className="p-6 text-sm">Loading PDF…</p>;
  return <div className="flex flex-col gap-4 bg-neutral-200 p-4 pb-20">
    {Array.from({ length: doc.numPages }, (_, index) => <PdfPage key={index} doc={doc} number={index + 1} />)}
  </div>;
}

function PdfPage({ doc, number }: { doc: PDFDocumentProxy; number: number }) {
  const { width, scale, viewport } = usePreviewZoom();
  const container = React.useRef<HTMLDivElement>(null);
  const canvasHost = React.useRef<HTMLDivElement>(null);
  const textHost = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [page, setPage] = React.useState<PDFPageProxy | null>(null);
  const [error, setError] = React.useState('');
  const pageWidth = Math.max(1, width - 32);
  const base = page?.getViewport({ scale: 1 });
  const fit = base ? pageWidth / base.width : 1;
  const pageHeight = base ? base.height * fit : pageWidth * 1.414;

  React.useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { root: viewport.current, rootMargin: '600px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [viewport]);
  React.useEffect(() => {
    if (!visible || page) return;
    let cancelled = false;
    void doc.getPage(number).then((value) => { if (!cancelled) setPage(value); })
      .catch(() => { if (!cancelled) setError('This page could not be displayed.'); });
    return () => { cancelled = true; };
  }, [doc, number, page, visible]);

  React.useEffect(() => {
    const host = canvasHost.current;
    if (!page || !host) return;
    if (!visible) { host.replaceChildren(); return; }
    let task: RenderTask | undefined;
    let cancelled = false;
    // Keep pinches smooth, then sharpen the visible pages at the new scale.
    const timer = setTimeout(() => {
      const density = Math.min(window.devicePixelRatio * scale, 4096 / pageWidth, 4096 / pageHeight);
      const target = page.getViewport({ scale: fit * density });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(target.width);
      canvas.height = Math.ceil(target.height);
      canvas.style.width = `${pageWidth}px`;
      canvas.style.height = `${pageHeight}px`;
      task = page.render({ canvas, viewport: target });
      void task.promise.then(() => { if (!cancelled) host.replaceChildren(canvas); })
        .catch((e) => { if (!cancelled && e?.name !== 'RenderingCancelledException') setError('This page could not be displayed.'); });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); task?.cancel(); };
  }, [page, visible, fit, scale, pageWidth, pageHeight]);

  React.useEffect(() => {
    const host = textHost.current;
    if (!page || !host) return;
    host.replaceChildren();
    if (!visible) return;
    let cancelled = false;
    let layer: InstanceType<typeof import('pdfjs-dist').TextLayer> | undefined;
    void loadPdf().then(async ({ TextLayer }) => {
      if (cancelled) return;
      layer = new TextLayer({ textContentSource: page.streamTextContent(), container: host, viewport: page.getViewport({ scale: fit }) });
      await layer.render();
    }).catch(() => {}); // Scanned PDFs can still render without a text layer.
    return () => { cancelled = true; layer?.cancel(); host.replaceChildren(); };
  }, [page, fit, visible]);

  return <div ref={container} className="tmj-pdf-page relative shrink-0 bg-white shadow" role="group" aria-label={`Page ${number}`}
    style={{ width: pageWidth, height: pageHeight, '--total-scale-factor': fit } as React.CSSProperties}>
    <div ref={canvasHost} />
    <div ref={textHost} className="textLayer" />
    {error ? <p role="alert" className="absolute left-4 top-4 text-sm text-red-700">{error}</p> : null}
  </div>;
}
