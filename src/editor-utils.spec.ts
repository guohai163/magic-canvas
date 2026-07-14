import { describe, expect, it } from 'vitest';
import {
  adaptSourceSize,
  getAnchorOffset,
  getExpandedSize,
  validateEditorCanvasSize,
  viewportPointToCanvas,
} from './editor-utils';

describe('editor geometry', () => {
  it('adapts small images to valid generation dimensions', () => {
    const size = adaptSourceSize(512, 512);
    expect(size.width % 16).toBe(0);
    expect(size.height % 16).toBe(0);
    expect(size.width * size.height).toBeGreaterThanOrEqual(655_360);
  });

  it('expands to a target ratio without cropping the source', () => {
    expect(getExpandedSize({ width: 1536, height: 1024 }, 1)).toEqual({ width: 1536, height: 1536 });
    expect(getExpandedSize({ width: 1024, height: 1536 }, 16 / 9)).toEqual({ width: 2736, height: 1536 });
  });

  it('positions the source using nine-grid anchors', () => {
    const canvas = { width: 1920, height: 1088 };
    const source = { width: 1024, height: 768 };
    expect(getAnchorOffset(canvas, source, 'left', 'top')).toEqual({ x: 0, y: 0 });
    expect(getAnchorOffset(canvas, source, 'center', 'center')).toEqual({ x: 448, y: 160 });
    expect(getAnchorOffset(canvas, source, 'right', 'bottom')).toEqual({ x: 896, y: 320 });
  });

  it('maps viewport coordinates back into canvas pixels', () => {
    expect(viewportPointToCanvas({ x: 300, y: 220 }, { x: 100, y: 20 }, 0.5)).toEqual({ x: 400, y: 400 });
  });

  it('rejects canvas dimensions that crop or exceed platform limits', () => {
    expect(validateEditorCanvasSize(
      { width: 1024, height: 1024 },
      { width: 1536, height: 1024 },
    )).toMatch(/不能小于原图/);
    expect(validateEditorCanvasSize({ width: 3840, height: 3840 })).toMatch(/总像素/);
  });
});
