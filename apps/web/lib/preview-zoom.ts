export const MIN_PREVIEW_SCALE = 1;
export const MAX_PREVIEW_SCALE = 8;
export type Point = { x: number; y: number };

export function previewScale(value: number): number {
  return Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, value));
}

/** Keep the content under the fingers or pointer in the same screen position. */
export function zoomScroll(scroll: Point, from: number, to: number, anchor: Point): Point {
  return { x: (scroll.x + anchor.x) * to / from - anchor.x, y: (scroll.y + anchor.y) * to / from - anchor.y };
}

export function pinchPoints(points: Point[]): { center: Point; distance: number } {
  const a = points[0]!, b = points[1] ?? a;
  return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(b.x - a.x, b.y - a.y) };
}
