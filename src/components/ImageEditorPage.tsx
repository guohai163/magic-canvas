import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage } from 'react-konva';
import {
  Brush,
  Check,
  CircleDotDashed,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  ImagePlus,
  LocateFixed,
  Maximize,
  Move,
  Redo2,
  RotateCcw,
  Save,
  Sparkles,
  Undo2,
  ZoomIn,
} from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES, CUSTOM_SIZE_LIMITS, QUALITY_OPTIONS } from '../constants';
import {
  EDITOR_ASPECT_RATIOS,
  canvasToBlob,
  createEditorSourceFromFile,
  getAnchorOffset,
  getExpandedSize,
  hasOutpaintArea,
  maskHasSelection,
  renderSelectionMask,
  renderSourceCanvas,
  validateEditorCanvasSize,
  viewportPointToCanvas,
  type CanvasPoint,
  type CanvasSize,
  type EditorTool,
  type MaskStroke,
  type SourcePlacement,
} from '../editor-utils';
import type { EditorSource, GeneratedImage, ImageFormState, SupportedModel } from '../types';

export type RegionEditorSubmission = {
  model: SupportedModel;
  prompt: string;
  negativePrompt: string;
  quality: ImageFormState['quality'];
  width: number;
  height: number;
  feather: number;
  image: Blob;
  mask: Blob;
  operation: 'region-edit' | 'outpaint';
  parentId?: string;
};

type ImageEditorPageProps = {
  source: EditorSource | null;
  configuredModels: SupportedModel[];
  initialModel: SupportedModel;
  initialQuality: ImageFormState['quality'];
  onSourceChange: (source: EditorSource | null) => void;
  onGenerate: (submission: RegionEditorSubmission) => Promise<GeneratedImage>;
  onSaveResult: (image: GeneratedImage) => Promise<void>;
};

const MASK_COLOR = '#ff315e';
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const HISTORY_LIMIT = 50;

function useCanvasImage(source: string | undefined) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!source) {
      setImage(null);
      return;
    }
    const nextImage = new Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.src = source;
  }, [source]);
  return image;
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={active ? 'editor-icon-button is-active' : 'editor-icon-button'}
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ImageEditorPage({
  source,
  configuredModels,
  initialModel,
  initialQuality,
  onSourceChange,
  onGenerate,
  onSaveResult,
}: ImageEditorPageProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const draftStrokeRef = useRef<MaskStroke | null>(null);
  const image = useCanvasImage(source?.imageDataUrl);
  const [viewportSize, setViewportSize] = useState({ width: 900, height: 680 });
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 1024, height: 1024 });
  const [sourceOffset, setSourceOffset] = useState<CanvasPoint>({ x: 0, y: 0 });
  const [customWidth, setCustomWidth] = useState('1024');
  const [customHeight, setCustomHeight] = useState('1024');
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>('brush');
  const [brushSize, setBrushSize] = useState(64);
  const [feather, setFeather] = useState(8);
  const [showMask, setShowMask] = useState(true);
  const [selectionInverted, setSelectionInverted] = useState(false);
  const [strokeHistory, setStrokeHistory] = useState<MaskStroke[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [draftStroke, setDraftStroke] = useState<MaskStroke | null>(null);
  const [viewScale, setViewScale] = useState(1);
  const [viewOrigin, setViewOrigin] = useState<CanvasPoint>({ x: 0, y: 0 });
  const [model, setModel] = useState<SupportedModel>(initialModel);
  const [quality, setQuality] = useState<ImageFormState['quality']>(initialQuality);
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedImage | null>(null);
  const [resultSaved, setResultSaved] = useState(false);
  const [comparePosition, setComparePosition] = useState(50);
  const [comparisonSource, setComparisonSource] = useState<string | null>(null);
  const strokes = strokeHistory[historyIndex] ?? [];
  const sourcePlacement: SourcePlacement | null = source
    ? { ...sourceOffset, width: source.width, height: source.height }
    : null;

  const fitView = useCallback((nextCanvas = canvasSize) => {
    const padding = 36;
    const scale = Math.min(
      (viewportSize.width - padding * 2) / nextCanvas.width,
      (viewportSize.height - padding * 2) / nextCanvas.height,
      1,
    );
    const boundedScale = Math.max(MIN_ZOOM, scale);
    setViewScale(boundedScale);
    setViewOrigin({
      x: Math.round((viewportSize.width - nextCanvas.width * boundedScale) / 2),
      y: Math.round((viewportSize.height - nextCanvas.height * boundedScale) / 2),
    });
  }, [canvasSize, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setViewportSize({
          width: Math.max(320, Math.round(entry.contentRect.width)),
          height: Math.max(420, Math.round(entry.contentRect.height)),
        });
      }
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [source?.imageDataUrl]);

  useEffect(() => {
    if (!source) {
      setResult(null);
      return;
    }
    const nextCanvas = { width: source.width, height: source.height };
    setCanvasSize(nextCanvas);
    setCustomWidth(String(nextCanvas.width));
    setCustomHeight(String(nextCanvas.height));
    setSourceOffset({ x: 0, y: 0 });
    setStrokeHistory([[]]);
    setHistoryIndex(0);
    setPrompt(source.prompt);
    setSelectionInverted(false);
    setResult(null);
    setResultSaved(false);
    setComparisonSource(null);
    setEditorError(null);
    setCanvasError(null);
    window.requestAnimationFrame(() => fitView(nextCanvas));
  }, [source?.imageDataUrl]);

  useEffect(() => {
    fitView();
  }, [viewportSize.width, viewportSize.height]);

  useEffect(() => {
    if (configuredModels.includes(model)) {
      return;
    }
    setModel(configuredModels[0] ?? initialModel);
  }, [configuredModels, initialModel, model]);

  function commitStrokes(nextStrokes: MaskStroke[]) {
    const nextHistory = [...strokeHistory.slice(0, historyIndex + 1), nextStrokes].slice(-HISTORY_LIMIT);
    setStrokeHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  }

  function resetStrokes() {
    setStrokeHistory([[]]);
    setHistoryIndex(0);
    setDraftStroke(null);
    draftStrokeRef.current = null;
    setSelectionInverted(false);
  }

  function applyCanvasSize(nextSize: CanvasSize) {
    if (!source) {
      return;
    }
    const validationError = validateEditorCanvasSize(nextSize, source);
    if (validationError) {
      setCanvasError(validationError);
      return;
    }
    setCanvasError(null);
    setCanvasSize(nextSize);
    setCustomWidth(String(nextSize.width));
    setCustomHeight(String(nextSize.height));
    setSourceOffset(getAnchorOffset(nextSize, source, 'center', 'center'));
    resetStrokes();
    fitView(nextSize);
  }

  function applyAspectRatio(ratio: number) {
    if (!source) {
      return;
    }
    applyCanvasSize(getExpandedSize(source, ratio));
  }

  function applyAnchor(horizontal: 'left' | 'center' | 'right', vertical: 'top' | 'center' | 'bottom') {
    if (!source) {
      return;
    }
    setSourceOffset(getAnchorOffset(canvasSize, source, horizontal, vertical));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!source || (tool !== 'brush' && tool !== 'eraser')) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = viewportPointToCanvas(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      viewOrigin,
      viewScale,
    );
    if (!point || point.x < 0 || point.y < 0 || point.x > canvasSize.width || point.y > canvasSize.height) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    drawingRef.current = true;
    const nextStroke = { tool, size: brushSize, points: [point.x, point.y, point.x + 0.01, point.y + 0.01] };
    draftStrokeRef.current = nextStroke;
    setDraftStroke(nextStroke);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const currentDraft = draftStrokeRef.current;
    if (!drawingRef.current || !currentDraft) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = viewportPointToCanvas(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      viewOrigin,
      viewScale,
    );
    const nextDraft = {
      ...currentDraft,
      points: [...currentDraft.points, point.x, point.y],
    };
    draftStrokeRef.current = nextDraft;
    setDraftStroke(nextDraft);
  }

  function handlePointerUp(event?: React.PointerEvent<HTMLDivElement>) {
    if (!drawingRef.current) {
      return;
    }
    drawingRef.current = false;
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const completedStroke = draftStrokeRef.current;
    if (completedStroke) {
      commitStrokes([...strokes, completedStroke]);
    }
    draftStrokeRef.current = null;
    setDraftStroke(null);
  }

  function invertSelection() {
    setSelectionInverted((value) => !value);
  }

  function handleWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) {
      return;
    }
    const canvasPoint = viewportPointToCanvas(pointer, viewOrigin, viewScale);
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewScale * (direction > 0 ? 1.12 : 0.89)));
    setViewScale(nextScale);
    setViewOrigin({
      x: pointer.x - canvasPoint.x * nextScale,
      y: pointer.y - canvasPoint.y * nextScale,
    });
  }

  async function handleUpload(files: FileList | null) {
    const file = files?.[0];
    if (!file) {
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      setEditorError('仅支持 PNG、JPEG、WEBP 或 GIF 图片。');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setEditorError('上传图片不能超过 10MB。');
      return;
    }
    try {
      onSourceChange(await createEditorSourceFromFile(file));
    } catch (caughtError) {
      setEditorError(caughtError instanceof Error ? caughtError.message : '图片读取失败。');
    }
  }

  async function handleGenerate() {
    if (!source || !sourcePlacement || !prompt.trim()) {
      return;
    }
    setEditorError(null);
    setIsGenerating(true);
    try {
      const maskCanvas = renderSelectionMask(canvasSize, sourcePlacement, strokes, feather, selectionInverted);
      if (!maskHasSelection(maskCanvas)) {
        throw new Error('请先涂抹需要修改的区域，或扩大画布进行扩图。');
      }
      const sourceCanvas = await renderSourceCanvas(source.imageDataUrl, canvasSize, sourcePlacement);
      setComparisonSource(sourceCanvas.toDataURL('image/png'));
      const nextResult = await onGenerate({
        model,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        quality,
        width: canvasSize.width,
        height: canvasSize.height,
        feather,
        image: await canvasToBlob(sourceCanvas),
        mask: await canvasToBlob(maskCanvas),
        operation: hasOutpaintArea(canvasSize, sourcePlacement) ? 'outpaint' : 'region-edit',
        parentId: source.id,
      });
      setResult(nextResult);
      setResultSaved(false);
      setComparePosition(50);
    } catch (caughtError) {
      const message = caughtError && typeof caughtError === 'object' && 'message' in caughtError
        ? String(caughtError.message)
        : '局部编辑失败，请重试。';
      setEditorError(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveResult() {
    if (!result || resultSaved) {
      return;
    }
    await onSaveResult(result);
    setResultSaved(true);
  }

  function handleUseResult() {
    if (!result) {
      return;
    }
    onSourceChange({
      id: result.id,
      imageDataUrl: result.imageDataUrl,
      filename: result.filename,
      prompt: result.prompt,
      width: result.width,
      height: result.height,
      originalWidth: result.width,
      originalHeight: result.height,
    });
  }

  const displayedStrokes = useMemo(
    () => draftStroke ? [...strokes, draftStroke] : strokes,
    [draftStroke, strokes],
  );
  const isAdapted = Boolean(source && (source.width !== source.originalWidth || source.height !== source.originalHeight));
  const canSubmit = Boolean(source && prompt.trim() && configuredModels.includes(model) && !canvasError && !isGenerating);

  const handleFile = useCallback(async (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      setEditorError('仅支持 PNG、JPEG、WEBP 或 GIF 图片。');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setEditorError('上传图片不能超过 10MB。');
      return;
    }
    try {
      onSourceChange(await createEditorSourceFromFile(file));
    } catch (caughtError) {
      setEditorError(caughtError instanceof Error ? caughtError.message : '图片读取失败。');
    }
  }, [onSourceChange]);

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const imageFile = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'));
      if (imageFile) {
        event.preventDefault();
        void handleFile(imageFile);
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFile]);

  if (!source) {
    return (
      <section className="editor-empty-page">
        <div className="editor-empty-content">
          <ImagePlus size={42} aria-hidden="true" />
          <h2>选择一张图片开始局部编辑</h2>
          <p>可选择或直接粘贴本地图片，也可以从生成结果或历史记录直接进入。</p>
          <label className="action-button primary editor-upload-button">
            <input
              className="upload-input"
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              onChange={(event) => void handleUpload(event.target.files)}
            />
            <ImagePlus size={18} aria-hidden="true" />
            选择图片
          </label>
          {editorError ? <div className="feedback feedback-error">{editorError}</div> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="image-editor-page">
      <div className="editor-toolbar" aria-label="编辑工具栏">
        <div className="editor-tool-group">
          <ToolButton label="画笔" active={tool === 'brush'} onClick={() => setTool('brush')}><Brush size={18} /></ToolButton>
          <ToolButton label="橡皮" active={tool === 'eraser'} onClick={() => setTool('eraser')}><Eraser size={18} /></ToolButton>
          <ToolButton label="平移画布" active={tool === 'pan'} onClick={() => setTool('pan')}><Hand size={18} /></ToolButton>
          <ToolButton label="移动原图" active={tool === 'move'} onClick={() => setTool('move')}><Move size={18} /></ToolButton>
        </div>
        <div className="editor-tool-group">
          <ToolButton label="撤销" disabled={historyIndex === 0} onClick={() => setHistoryIndex((value) => Math.max(0, value - 1))}><Undo2 size={18} /></ToolButton>
          <ToolButton label="重做" disabled={historyIndex >= strokeHistory.length - 1} onClick={() => setHistoryIndex((value) => Math.min(strokeHistory.length - 1, value + 1))}><Redo2 size={18} /></ToolButton>
          <ToolButton label="清空遮罩" disabled={strokes.length === 0} onClick={resetStrokes}><RotateCcw size={18} /></ToolButton>
          <ToolButton label="反选遮罩" onClick={invertSelection}><CircleDotDashed size={18} /></ToolButton>
          <ToolButton label={showMask ? '隐藏遮罩' : '显示遮罩'} active={showMask} onClick={() => setShowMask((value) => !value)}>
            {showMask ? <Eye size={18} /> : <EyeOff size={18} />}
          </ToolButton>
        </div>
        <div className="editor-tool-group">
          <ToolButton label="适应窗口" onClick={() => fitView()}><Maximize size={18} /></ToolButton>
          <ToolButton label="1:1 查看" onClick={() => {
            setViewScale(1);
            setViewOrigin({ x: (viewportSize.width - canvasSize.width) / 2, y: (viewportSize.height - canvasSize.height) / 2 });
          }}><ZoomIn size={18} /></ToolButton>
          <span className="editor-zoom-label">{Math.round(viewScale * 100)}%</span>
        </div>
      </div>

      <div className="editor-workspace">
        <div
          ref={viewportRef}
          className={`editor-canvas-viewport tool-${tool}`}
        >
          <Stage
            width={viewportSize.width}
            height={viewportSize.height}
            onWheel={handleWheel}
          >
            <Layer>
              <Group
                x={viewOrigin.x}
                y={viewOrigin.y}
                scaleX={viewScale}
                scaleY={viewScale}
                draggable={tool === 'pan'}
                onDragEnd={(event) => setViewOrigin({ x: event.target.x(), y: event.target.y() })}
              >
                <Rect width={canvasSize.width} height={canvasSize.height} fill="#ffffff" shadowColor="#111827" shadowBlur={24 / viewScale} shadowOpacity={0.22} />
                {image ? (
                  <KonvaImage
                    image={image}
                    x={sourceOffset.x}
                    y={sourceOffset.y}
                    width={source.width}
                    height={source.height}
                    draggable={tool === 'move'}
                    dragBoundFunc={(position) => ({
                      x: Math.max(0, Math.min(canvasSize.width - source.width, position.x)),
                      y: Math.max(0, Math.min(canvasSize.height - source.height, position.y)),
                    })}
                    onDragEnd={(event) => setSourceOffset({ x: Math.round(event.target.x()), y: Math.round(event.target.y()) })}
                  />
                ) : null}
              </Group>
            </Layer>
            {showMask && sourcePlacement ? (
              <Layer listening={false} opacity={0.42}>
                <Group x={viewOrigin.x} y={viewOrigin.y} scaleX={viewScale} scaleY={viewScale}>
                  {selectionInverted ? <Rect width={canvasSize.width} height={canvasSize.height} fill={MASK_COLOR} /> : null}
                  <Rect width={canvasSize.width} height={sourcePlacement.y} fill={MASK_COLOR} globalCompositeOperation={selectionInverted ? 'destination-out' : 'source-over'} />
                  <Rect y={sourcePlacement.y + sourcePlacement.height} width={canvasSize.width} height={Math.max(0, canvasSize.height - sourcePlacement.y - sourcePlacement.height)} fill={MASK_COLOR} globalCompositeOperation={selectionInverted ? 'destination-out' : 'source-over'} />
                  <Rect x={0} y={sourcePlacement.y} width={sourcePlacement.x} height={sourcePlacement.height} fill={MASK_COLOR} globalCompositeOperation={selectionInverted ? 'destination-out' : 'source-over'} />
                  <Rect x={sourcePlacement.x + sourcePlacement.width} y={sourcePlacement.y} width={Math.max(0, canvasSize.width - sourcePlacement.x - sourcePlacement.width)} height={sourcePlacement.height} fill={MASK_COLOR} globalCompositeOperation={selectionInverted ? 'destination-out' : 'source-over'} />
                  {displayedStrokes.map((stroke, index) => (
                    <Line
                      key={`${index}-${stroke.points.length}`}
                      points={stroke.points}
                      stroke={MASK_COLOR}
                      strokeWidth={stroke.size}
                      lineCap="round"
                      lineJoin="round"
                      globalCompositeOperation={selectionInverted
                        ? stroke.tool === 'eraser' ? 'source-over' : 'destination-out'
                        : stroke.tool === 'eraser' ? 'destination-out' : 'source-over'}
                    />
                  ))}
                </Group>
              </Layer>
            ) : null}
          </Stage>
          {tool === 'brush' || tool === 'eraser' ? (
            <div
              className="editor-draw-surface"
              aria-label={tool === 'brush' ? '遮罩画笔画布' : '遮罩橡皮画布'}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          ) : null}
        </div>

        <aside className="editor-settings-panel">
          <div className="editor-settings-scroll">
            <section className="editor-setting-section">
              <div className="field-head"><span>源图片</span><small>{source.originalWidth} x {source.originalHeight}</small></div>
              <div className="editor-source-row">
                <img src={source.imageDataUrl} alt="编辑源图" />
                <div><strong>{source.filename}</strong><small>{source.width} x {source.height}</small></div>
                <label className="editor-icon-button" title="更换图片" aria-label="更换图片">
                  <input className="upload-input" type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} onChange={(event) => void handleUpload(event.target.files)} />
                  <ImagePlus size={18} />
                </label>
              </div>
              {isAdapted ? <p className="editor-notice">原图已按生成限制适配为 {source.width} x {source.height}，提交前不会再改变。</p> : null}
            </section>

            <section className="editor-setting-section">
              <div className="field-head"><span>遮罩</span><small>红色区域将被修改</small></div>
              <label className="editor-slider-row"><span>画笔大小</span><input type="range" min="8" max="256" step="4" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /><strong>{brushSize}px</strong></label>
              <label className="editor-slider-row"><span>边缘羽化</span><input type="range" min="0" max="64" step="2" value={feather} onChange={(event) => setFeather(Number(event.target.value))} /><strong>{feather}px</strong></label>
            </section>

            <section className="editor-setting-section">
              <div className="field-head"><span>扩图画布</span><small>{canvasSize.width} x {canvasSize.height}</small></div>
              <div className="editor-ratio-grid">
                {EDITOR_ASPECT_RATIOS.map((ratio) => (
                  <button key={ratio.label} className="editor-option-button" type="button" onClick={() => applyAspectRatio(ratio.value)}>{ratio.label}</button>
                ))}
              </div>
              <div className="editor-dimension-grid">
                <label><span>宽度</span><input type="number" min={source.width} max={CUSTOM_SIZE_LIMITS.maxLongEdge} step={16} value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} /></label>
                <label><span>高度</span><input type="number" min={source.height} max={CUSTOM_SIZE_LIMITS.maxLongEdge} step={16} value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} /></label>
              </div>
              <button className="ghost-button editor-apply-size" type="button" onClick={() => applyCanvasSize({ width: Number(customWidth), height: Number(customHeight) })}>应用尺寸</button>
              {canvasError ? <small className="upload-error">{canvasError}</small> : null}
              <div className="anchor-grid" aria-label="原图对齐位置">
                {(['top', 'center', 'bottom'] as const).flatMap((vertical) =>
                  (['left', 'center', 'right'] as const).map((horizontal) => (
                    <button key={`${vertical}-${horizontal}`} type="button" aria-label={`${vertical}-${horizontal}`} onClick={() => applyAnchor(horizontal, vertical)}>
                      <LocateFixed size={14} />
                    </button>
                  )),
                )}
              </div>
            </section>

            <section className="editor-setting-section">
              <div className="field-head"><span>编辑要求</span><small>{model === 'gemini-3.1-flash-image' ? '遮罩参考（实验性）' : '原生遮罩'}</small></div>
              <textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：将选区中的杯子替换成一束白色郁金香，保持光影和桌面不变" />
              <textarea rows={2} value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} placeholder="负面提示词（可选）" />
              <label className="field"><span>模型</span><select value={model} onChange={(event) => setModel(event.target.value as SupportedModel)}>{configuredModels.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label className="field"><span>质量</span><select value={quality} onChange={(event) => setQuality(event.target.value as ImageFormState['quality'])}>{QUALITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </section>

            {editorError ? <div className="feedback feedback-error"><strong>编辑失败</strong><p>{editorError}</p></div> : null}

            {result ? (
              <section className="editor-result-section">
                <div className="field-head"><span>编辑结果</span><small>{result.width} x {result.height}</small></div>
                <div className="editor-compare" style={{ aspectRatio: `${result.width} / ${result.height}` }}>
                  <img src={result.imageDataUrl} alt="编辑后" />
                  <img className="editor-compare-before" src={comparisonSource ?? source.imageDataUrl} alt="编辑前" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }} />
                  <div className="editor-compare-line" style={{ left: `${comparePosition}%` }} />
                </div>
                <input className="editor-compare-slider" type="range" min="0" max="100" value={comparePosition} onChange={(event) => setComparePosition(Number(event.target.value))} aria-label="前后对比" />
                <div className="editor-result-actions">
                  <button className="action-button primary" type="button" onClick={handleUseResult}><Check size={17} />应用并继续</button>
                  <button className="action-button" type="button" disabled={resultSaved} onClick={() => void handleSaveResult()}><Save size={17} />{resultSaved ? '已保存' : '保存历史'}</button>
                  <a className="action-button" href={result.imageDataUrl} download={result.filename}><Download size={17} />下载</a>
                </div>
              </section>
            ) : null}
          </div>

          <div className="editor-submit-bar">
            <button className="submit-button" type="button" disabled={!canSubmit} onClick={() => void handleGenerate()}>
              <Sparkles size={18} />
              {isGenerating ? '局部编辑中...' : '生成编辑结果'}
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
