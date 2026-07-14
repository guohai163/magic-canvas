import { CUSTOM_SIZE_LIMITS } from './constants';
import type { EditorSource } from './types';

export type EditorTool = 'brush' | 'eraser' | 'pan' | 'move';

export type MaskStroke = {
  tool: 'brush' | 'eraser';
  points: number[];
  size: number;
};

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasSize = {
  width: number;
  height: number;
};

export type SourcePlacement = CanvasPoint & CanvasSize;

export const EDITOR_ASPECT_RATIOS = [
  { label: '1:1', value: 1 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
] as const;

function roundUpToStep(value: number): number {
  return Math.ceil(value / CUSTOM_SIZE_LIMITS.step) * CUSTOM_SIZE_LIMITS.step;
}

function roundToStep(value: number): number {
  return Math.max(CUSTOM_SIZE_LIMITS.step, Math.round(value / CUSTOM_SIZE_LIMITS.step) * CUSTOM_SIZE_LIMITS.step);
}

export function validateEditorCanvasSize(size: CanvasSize, minimum?: CanvasSize): string | null {
  const { width, height } = size;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return '请输入有效的画布宽度和高度。';
  }

  if (width % CUSTOM_SIZE_LIMITS.step !== 0 || height % CUSTOM_SIZE_LIMITS.step !== 0) {
    return `画布宽高必须能被 ${CUSTOM_SIZE_LIMITS.step} 整除。`;
  }

  if (minimum && (width < minimum.width || height < minimum.height)) {
    return `扩图画布不能小于原图 ${minimum.width} x ${minimum.height}。`;
  }

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  if (longEdge > CUSTOM_SIZE_LIMITS.maxLongEdge) {
    return `最长边不能超过 ${CUSTOM_SIZE_LIMITS.maxLongEdge}px。`;
  }
  if (shortEdge < CUSTOM_SIZE_LIMITS.minShortEdge) {
    return `最短边不能小于 ${CUSTOM_SIZE_LIMITS.minShortEdge}px。`;
  }
  if (longEdge / shortEdge > CUSTOM_SIZE_LIMITS.maxRatio) {
    return `宽高比例不能超过 ${CUSTOM_SIZE_LIMITS.maxRatio}:1。`;
  }
  if (pixels < CUSTOM_SIZE_LIMITS.minPixels || pixels > CUSTOM_SIZE_LIMITS.maxPixels) {
    return `总像素需介于 ${CUSTOM_SIZE_LIMITS.minPixels.toLocaleString('zh-CN')} 和 ${CUSTOM_SIZE_LIMITS.maxPixels.toLocaleString('zh-CN')} 之间。`;
  }
  return null;
}

export function adaptSourceSize(width: number, height: number): CanvasSize {
  const ratio = width / height;
  let scale = 1;
  const pixels = width * height;

  if (pixels < CUSTOM_SIZE_LIMITS.minPixels) {
    scale = Math.max(scale, Math.sqrt(CUSTOM_SIZE_LIMITS.minPixels / pixels));
  }
  if (pixels > CUSTOM_SIZE_LIMITS.maxPixels) {
    scale = Math.min(scale, Math.sqrt(CUSTOM_SIZE_LIMITS.maxPixels / pixels));
  }
  if (Math.max(width, height) * scale > CUSTOM_SIZE_LIMITS.maxLongEdge) {
    scale = Math.min(scale, CUSTOM_SIZE_LIMITS.maxLongEdge / Math.max(width, height));
  }

  let nextWidth = roundToStep(width * scale);
  let nextHeight = roundToStep(height * scale);

  while (nextWidth * nextHeight < CUSTOM_SIZE_LIMITS.minPixels) {
    if (ratio >= 1) {
      nextWidth += CUSTOM_SIZE_LIMITS.step;
      nextHeight = roundToStep(nextWidth / ratio);
    } else {
      nextHeight += CUSTOM_SIZE_LIMITS.step;
      nextWidth = roundToStep(nextHeight * ratio);
    }
  }

  while (
    nextWidth * nextHeight > CUSTOM_SIZE_LIMITS.maxPixels ||
    Math.max(nextWidth, nextHeight) > CUSTOM_SIZE_LIMITS.maxLongEdge
  ) {
    if (ratio >= 1) {
      nextWidth -= CUSTOM_SIZE_LIMITS.step;
      nextHeight = roundToStep(nextWidth / ratio);
    } else {
      nextHeight -= CUSTOM_SIZE_LIMITS.step;
      nextWidth = roundToStep(nextHeight * ratio);
    }
  }

  return { width: nextWidth, height: nextHeight };
}

export function getExpandedSize(source: CanvasSize, aspectRatio: number): CanvasSize {
  let width = source.width;
  let height = source.height;
  if (width / height < aspectRatio) {
    width = roundUpToStep(height * aspectRatio);
  } else {
    height = roundUpToStep(width / aspectRatio);
  }
  return { width, height };
}

export function getAnchorOffset(
  canvas: CanvasSize,
  source: CanvasSize,
  horizontal: 'left' | 'center' | 'right',
  vertical: 'top' | 'center' | 'bottom',
): CanvasPoint {
  const availableX = Math.max(0, canvas.width - source.width);
  const availableY = Math.max(0, canvas.height - source.height);
  return {
    x: horizontal === 'left' ? 0 : horizontal === 'right' ? availableX : Math.round(availableX / 2),
    y: vertical === 'top' ? 0 : vertical === 'bottom' ? availableY : Math.round(availableY / 2),
  };
}

export function viewportPointToCanvas(point: CanvasPoint, origin: CanvasPoint, scale: number): CanvasPoint {
  return {
    x: (point.x - origin.x) / scale,
    y: (point.y - origin.y) / scale,
  };
}

export function hasOutpaintArea(canvas: CanvasSize, source: SourcePlacement): boolean {
  return source.x > 0 || source.y > 0 || source.x + source.width < canvas.width || source.y + source.height < canvas.height;
}

export function renderSelectionMask(
  canvasSize: CanvasSize,
  source: SourcePlacement,
  strokes: MaskStroke[],
  feather: number,
  inverted = false,
): HTMLCanvasElement {
  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = canvasSize.width;
  rawCanvas.height = canvasSize.height;
  const context = rawCanvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器无法创建遮罩画布。');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvasSize.width, canvasSize.height);
  context.clearRect(source.x, source.y, source.width, source.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const stroke of strokes) {
    if (stroke.points.length < 2) {
      continue;
    }
    context.save();
    context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = '#ffffff';
    context.lineWidth = stroke.size;
    context.beginPath();
    context.moveTo(stroke.points[0], stroke.points[1]);
    for (let index = 2; index < stroke.points.length; index += 2) {
      context.lineTo(stroke.points[index], stroke.points[index + 1]);
    }
    context.stroke();
    context.restore();
  }

  if (inverted) {
    const pixels = context.getImageData(0, 0, rawCanvas.width, rawCanvas.height);
    for (let index = 3; index < pixels.data.length; index += 4) {
      pixels.data[index] = 255 - pixels.data[index];
    }
    context.putImageData(pixels, 0, 0);
  }

  if (feather <= 0) {
    return rawCanvas;
  }

  const featheredCanvas = document.createElement('canvas');
  featheredCanvas.width = canvasSize.width;
  featheredCanvas.height = canvasSize.height;
  const featheredContext = featheredCanvas.getContext('2d');
  if (!featheredContext) {
    throw new Error('浏览器无法创建羽化遮罩。');
  }
  featheredContext.filter = `blur(${feather}px)`;
  featheredContext.drawImage(rawCanvas, 0, 0);
  return featheredCanvas;
}

export function maskHasSelection(maskCanvas: HTMLCanvasElement): boolean {
  const context = maskCanvas.getContext('2d');
  if (!context) {
    return false;
  }
  const pixels = context.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) {
      return true;
    }
  }
  return false;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('无法导出编辑画布。'));
      }
    }, 'image/png');
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败。'));
    image.src = url;
  });
}

export async function renderSourceCanvas(
  imageDataUrl: string,
  canvasSize: CanvasSize,
  source: SourcePlacement,
): Promise<HTMLCanvasElement> {
  const image = await loadImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器无法创建图片画布。');
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, source.x, source.y, source.width, source.height);
  return canvas;
}

export async function createEditorSourceFromFile(file: File): Promise<EditorSource> {
  const imageDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败。'));
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.readAsDataURL(file);
  });
  const image = await loadImage(imageDataUrl);
  const sourceRatio = Math.max(image.naturalWidth, image.naturalHeight) / Math.min(image.naturalWidth, image.naturalHeight);
  if (sourceRatio > CUSTOM_SIZE_LIMITS.maxRatio) {
    throw new Error(`图片宽高比例不能超过 ${CUSTOM_SIZE_LIMITS.maxRatio}:1。`);
  }
  const adapted = adaptSourceSize(image.naturalWidth, image.naturalHeight);
  return {
    imageDataUrl,
    filename: file.name || 'editor-source.png',
    prompt: '',
    width: adapted.width,
    height: adapted.height,
    originalWidth: image.naturalWidth,
    originalHeight: image.naturalHeight,
  };
}
