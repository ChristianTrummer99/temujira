export async function loadPdf(): Promise<typeof import('pdfjs-dist')> {
  throw new Error('PDF previews are available in the browser.');
}
