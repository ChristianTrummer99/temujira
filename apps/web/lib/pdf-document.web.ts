let pending: Promise<typeof import('pdfjs-dist')> | null = null;

export function loadPdf() {
  return pending ??= import('pdfjs-dist').then((pdf) => {
    pdf.GlobalWorkerOptions.workerSrc = `/pdfjs/${pdf.version}/pdf.worker.min.mjs`;
    return pdf;
  }).catch((error) => { pending = null; throw error; });
}
