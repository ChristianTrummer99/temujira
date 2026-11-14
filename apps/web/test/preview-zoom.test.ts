import { describe, expect, it } from 'vitest';
import { pinchPoints, previewScale, zoomScroll } from '../lib/preview-zoom';

describe('Preview pinch geometry', () => {
  it('keeps the content under an off-center pointer fixed through repeated pinches', () => {
    const anchor = { x: 245, y: 172 };
    const start = { x: 318, y: 901 };
    let scroll = start;
    let scale = 1;
    for (const next of [1.4, 2.1, 5, 8, 3.2, 1.2, 1]) {
      scroll = zoomScroll(scroll, scale, next, anchor);
      expect((scroll.x + anchor.x) / next).toBeCloseTo(start.x + anchor.x);
      expect((scroll.y + anchor.y) / next).toBeCloseTo(start.y + anchor.y);
      scale = next;
    }
    expect(scroll.x).toBeCloseTo(start.x);
    expect(scroll.y).toBeCloseTo(start.y);
  });

  it('keeps the midpoint fixed when fingers spread in opposite directions', () => {
    const start = pinchPoints([{ x: 100, y: 100 }, { x: 300, y: 300 }]);
    const end = pinchPoints([{ x: 0, y: 0 }, { x: 400, y: 400 }]);
    expect(end.center).toEqual(start.center);
    expect(end.distance / start.distance).toBeCloseTo(2);
  });

  it('uses the actual scale limit when pinching beyond the supported range', () => {
    const anchor = { x: 200, y: 100 };
    const start = { x: 150, y: 300 };
    const limited = previewScale(100);
    const scroll = zoomScroll(start, 8, limited, anchor);
    expect(limited).toBe(8);
    expect(scroll).toEqual(start);
    expect(previewScale(0.2)).toBe(1);
  });
});
