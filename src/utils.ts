import type {
  ApiErrorState,
  ApiProviderConfig,
  AspectRatio,
  GenerateRequestPayload,
  GenerateResponse,
  GeneratedImage,
  ImageSizePreset,
  ImageToPromptRequestPayload,
  ImageToPromptResponse,
  ImageFormState,
  PromptPolishRequestPayload,
  PromptPolishResponse,
  PromptReferenceItem,
  PromptReferenceResponse,
  RegionEditRequestPayload,
  SupportedModel,
  UploadState,
  UsageRequestPayload,
  UsageResponse,
} from './types';
import {
  ACCEPTED_IMAGE_TYPES,
  CUSTOM_SIZE_LIMITS,
  IMAGE_GENERATION_MODELS,
  MAX_UPLOAD_SIZE_BYTES,
  STYLE_PRESETS,
  SUPPORTED_MODELS,
} from './constants';

const MAX_REFERENCE_IMAGE_COUNT = 4;

export function buildSubmissionPrompt(formState: Pick<ImageFormState, 'prompt' | 'stylePreset'>): string {
  const prompt = formState.prompt.trim();
  const styleTemplate = STYLE_PRESETS.find((preset) => preset.id === formState.stylePreset)?.promptTemplate ?? '';
  const sections = [prompt];

  if (styleTemplate) {
    sections.push(`风格要求：${styleTemplate}`);
  }

  return sections.join('\n\n');
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

export function isSupportedModel(value: unknown): value is SupportedModel {
  return typeof value === 'string' && SUPPORTED_MODELS.includes(value as SupportedModel);
}

export function isImageGenerationModel(value: unknown): value is SupportedModel {
  return typeof value === 'string' && IMAGE_GENERATION_MODELS.includes(value as SupportedModel);
}

export function hasProviderCredentials(provider: ApiProviderConfig | undefined): provider is ApiProviderConfig {
  return Boolean(provider && normalizeBaseUrl(provider.baseUrl) && provider.apiKey.trim());
}

export function findApiProviderForModel(
  providers: ApiProviderConfig[],
  model: SupportedModel,
): ApiProviderConfig | undefined {
  const supportingProviders = providers.filter((provider) => provider.supportedModels.includes(model));
  return supportingProviders.find(hasProviderCredentials) ?? supportingProviders[0];
}

export function resolveApiConfigForModel(
  formState: ImageFormState,
  model: SupportedModel,
): { provider: ApiProviderConfig | undefined; baseUrl: string; apiKey: string; model: SupportedModel } {
  const provider = findApiProviderForModel(formState.apiProviders, model);

  return {
    provider,
    baseUrl: normalizeBaseUrl(provider?.baseUrl ?? formState.baseUrl),
    apiKey: (provider?.apiKey ?? formState.apiKey).trim(),
    model,
  };
}

export function resolveApiConfigForPreferredModels(
  formState: ImageFormState,
  preferredModels: SupportedModel[],
): { provider: ApiProviderConfig | undefined; baseUrl: string; apiKey: string; model: SupportedModel } {
  for (const model of preferredModels) {
    const resolved = resolveApiConfigForModel(formState, model);
    if (hasProviderCredentials(resolved.provider) || (formState.apiProviders.length === 0 && resolved.baseUrl && resolved.apiKey)) {
      return resolved;
    }
  }

  const fallbackModel = preferredModels[0] ?? formState.model;
  return {
    provider: undefined,
    baseUrl: '',
    apiKey: '',
    model: fallbackModel,
  };
}

export function validateForm(formState: ImageFormState): string | null {
  if (!isImageGenerationModel(formState.model)) {
    return '请选择受支持的生图模型。';
  }

  const activeProvider = findApiProviderForModel(formState.apiProviders, formState.model);
  if (formState.apiProviders.length > 0 && !activeProvider) {
    return `当前模型 ${formState.model} 未绑定接口，请先在设置页勾选支持的模型。`;
  }

  const activeBaseUrl = activeProvider?.baseUrl ?? formState.baseUrl;
  const activeApiKey = activeProvider?.apiKey ?? formState.apiKey;

  if (!normalizeBaseUrl(activeBaseUrl)) {
    return `请为当前模型 ${formState.model} 填写接口域名。`;
  }

  if (!activeApiKey.trim()) {
    return `请为当前模型 ${formState.model} 填写 API Key。`;
  }

  if (!formState.prompt.trim()) {
    return '请填写提示词后再生成图片。';
  }

  if (!isValidAspectRatio(formState.aspectRatio)) {
    return '请选择受支持的图片比例。';
  }

  if (!isValidImageSizePreset(formState.imageSize)) {
    return '请选择受支持的生成尺寸。';
  }

  if (formState.sizeMode === 'custom') {
    const customSizeValidation = validateCustomSize(formState.customWidth, formState.customHeight);
    if (customSizeValidation) {
      return customSizeValidation;
    }
  }

  const validQualities = new Set(['low', 'medium', 'high', 'auto']);
  if (!validQualities.has(formState.quality)) {
    return '请选择受支持的图片品质。';
  }

  return null;
}

export function isValidAspectRatio(value: string): value is AspectRatio {
  return ['1:1', '3:2', '2:3', '16:9', '9:16'].includes(value);
}

export function isValidImageSizePreset(value: string): value is ImageSizePreset {
  return ['1K', '2K', '4K'].includes(value);
}

export function isValidSizeString(value: string): boolean {
  return /^\d+x\d+$/i.test(value.trim());
}

export function normalizeSizeString(width: string | number, height: string | number): string {
  return `${String(width).trim()}x${String(height).trim()}`;
}

export function parseSizeString(value: string): { width: number; height: number } | null {
  const match = value.trim().match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return { width, height };
}

export function validateCustomSize(widthValue: string, heightValue: string): string | null {
  const width = Number(widthValue);
  const height = Number(heightValue);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return '自定义尺寸需要填写有效的宽度和高度。';
  }

  if (width % CUSTOM_SIZE_LIMITS.step !== 0 || height % CUSTOM_SIZE_LIMITS.step !== 0) {
    return `宽度和高度都必须能被 ${CUSTOM_SIZE_LIMITS.step} 整除。`;
  }

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const ratio = longEdge / shortEdge;
  const totalPixels = width * height;

  if (ratio > CUSTOM_SIZE_LIMITS.maxRatio) {
    return `宽高比例不能超过 ${CUSTOM_SIZE_LIMITS.maxRatio}:1。`;
  }

  if (longEdge > CUSTOM_SIZE_LIMITS.maxLongEdge) {
    return `最长边不能超过 ${CUSTOM_SIZE_LIMITS.maxLongEdge}px。`;
  }

  if (shortEdge < CUSTOM_SIZE_LIMITS.minShortEdge) {
    return `最短边不能小于 ${CUSTOM_SIZE_LIMITS.minShortEdge}px。`;
  }

  if (totalPixels < CUSTOM_SIZE_LIMITS.minPixels || totalPixels > CUSTOM_SIZE_LIMITS.maxPixels) {
    return `总像素需介于 ${CUSTOM_SIZE_LIMITS.minPixels.toLocaleString('zh-CN')} 和 ${CUSTOM_SIZE_LIMITS.maxPixels.toLocaleString('zh-CN')} 之间。`;
  }

  return null;
}

export function getResolvedSize(formState: ImageFormState): string {
  return formState.sizeMode === 'custom'
    ? normalizeSizeString(formState.customWidth, formState.customHeight)
    : getSizeForAspectRatio(formState.aspectRatio, formState.imageSize);
}

export function getSizeForAspectRatio(aspectRatio: AspectRatio, imageSize: ImageSizePreset): string {
  const sizeMap: Record<ImageSizePreset, Record<AspectRatio, string>> = {
    '1K': {
      '1:1': '1024x1024',
      '3:2': '1536x1024',
      '2:3': '1024x1536',
      '16:9': '1920x1088',
      '9:16': '1088x1920',
    },
    '2K': {
      '1:1': '2048x2048',
      '3:2': '2048x1360',
      '2:3': '1360x2048',
      '16:9': '2048x1152',
      '9:16': '1152x2048',
    },
    '4K': {
      '1:1': '2880x2880',
      '3:2': '3456x2304',
      '2:3': '2304x3456',
      '16:9': '3840x2160',
      '9:16': '2160x3840',
    },
  };

  return sizeMap[imageSize][aspectRatio];
}

export function getCustomSizeHint(widthValue: string, heightValue: string): string {
  const width = Number(widthValue);
  const height = Number(heightValue);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return '请输入有效的宽度和高度，单位为 px。';
  }

  const validationMessage = validateCustomSize(widthValue, heightValue);
  if (validationMessage) {
    return validationMessage;
  }

  return `当前尺寸：${width}x${height}，宽高均可被 ${CUSTOM_SIZE_LIMITS.step} 整除。`;
}

export function validateUploadFiles(
  files: File[],
  mode: ImageFormState['generationMode'],
): string | null {
  if (files.length === 0) {
    return null;
  }

  if (mode === 'text') {
    return '纯文本生成模式不需要上传图片。';
  }

  if (mode === 'edit' && files.length > 1) {
    return '编辑原图模式仅支持上传 1 张图片。';
  }

  if (mode === 'reference' && files.length > MAX_REFERENCE_IMAGE_COUNT) {
    return `参考图生成最多支持上传 ${MAX_REFERENCE_IMAGE_COUNT} 张图片。`;
  }

  for (const file of files) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      return '仅支持 PNG、JPEG、WEBP 或 GIF 图片文件。';
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return '上传图片不能超过 10MB。';
    }
  }

  return null;
}

export function createImageDataUrl(base64: string): string {
  return `data:image/png;base64,${base64}`;
}

export function createDownloadFilename(date = new Date()): string {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ];

  return `generated-image-${parts.join('')}.png`;
}

export function createHistoryItem(
  formState: ImageFormState,
  imageDataUrl: string,
  dimensions?: { width?: number; height?: number },
  createdAt = new Date(),
): GeneratedImage {
  const width = typeof dimensions?.width === 'number' && dimensions.width > 0 ? dimensions.width : 0;
  const height = typeof dimensions?.height === 'number' && dimensions.height > 0 ? dimensions.height : 0;

  return {
    id: `${createdAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: createdAt.toISOString(),
    prompt: formState.prompt.trim(),
    stylePreset: formState.stylePreset,
    requestedSize: getResolvedSize(formState),
    quality: formState.quality,
    width,
    height,
    imageDataUrl,
    filename: createDownloadFilename(createdAt),
  };
}

export async function parseError(response: Response): Promise<ApiErrorState> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body = (await response.json()) as Record<string, unknown>;
    const error = body.error as Record<string, unknown> | undefined;
    const message =
      getString(error?.message) ??
      getString(body.message) ??
      `请求失败（HTTP ${response.status}）`;

    return {
      status: response.status,
      message,
      details: getString(error?.code) ?? getString(body.type),
    };
  }

  const text = (await response.text()).trim();
  return {
    status: response.status,
    message: text || `请求失败（HTTP ${response.status}）`,
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function requestGenerate(
  payload: GenerateRequestPayload,
): Promise<GenerateResponse> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as GenerateResponse;
}

export async function requestGenerateWithReferenceImages(
  payload: GenerateRequestPayload,
  files: File[],
): Promise<GenerateResponse> {
  const formData = new FormData();
  formData.append('baseUrl', payload.baseUrl);
  formData.append('apiKey', payload.apiKey);
  formData.append('model', payload.model);
  formData.append('prompt', payload.prompt);
  formData.append('negativePrompt', payload.negativePrompt);
  formData.append('sizeMode', payload.sizeMode);
  formData.append('size', payload.size);
  formData.append('aspectRatio', payload.aspectRatio);
  formData.append('imageSize', payload.imageSize);
  formData.append('quality', payload.quality);
  formData.append('mode', payload.mode ?? 'reference');

  for (const file of files) {
    formData.append('image', file);
  }

  const response = await fetch('/api/generate', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as GenerateResponse;
}

export async function requestGenerateWithEditImage(
  payload: GenerateRequestPayload,
  file: File,
): Promise<GenerateResponse> {
  const formData = new FormData();
  formData.append('baseUrl', payload.baseUrl);
  formData.append('apiKey', payload.apiKey);
  formData.append('model', payload.model);
  formData.append('prompt', payload.prompt);
  formData.append('negativePrompt', payload.negativePrompt);
  formData.append('sizeMode', payload.sizeMode);
  formData.append('size', payload.size);
  formData.append('aspectRatio', payload.aspectRatio);
  formData.append('imageSize', payload.imageSize);
  formData.append('quality', payload.quality);
  formData.append('mode', payload.mode ?? 'reference');
  formData.append('image', file);

  const response = await fetch('/api/generate', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as GenerateResponse;
}

export async function requestRegionEdit(payload: RegionEditRequestPayload): Promise<GenerateResponse> {
  const formData = new FormData();
  formData.append('baseUrl', payload.baseUrl);
  formData.append('apiKey', payload.apiKey);
  formData.append('model', payload.model);
  formData.append('prompt', payload.prompt);
  formData.append('negativePrompt', payload.negativePrompt);
  formData.append('quality', payload.quality);
  formData.append('width', String(payload.width));
  formData.append('height', String(payload.height));
  formData.append('feather', String(payload.feather));
  formData.append('image', payload.image, 'editor-source.png');
  formData.append('mask', payload.mask, 'editor-mask.png');

  const response = await fetch('/api/edit-region', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as GenerateResponse;
}

export async function requestPromptPolish(
  payload: PromptPolishRequestPayload,
): Promise<PromptPolishResponse> {
  const response = await fetch('/api/prompt-polish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as PromptPolishResponse;
}

export async function requestImageToPrompt(
  payload: ImageToPromptRequestPayload,
  file: File,
): Promise<ImageToPromptResponse> {
  const formData = new FormData();
  formData.append('baseUrl', payload.baseUrl);
  formData.append('apiKey', payload.apiKey);
  formData.append('model', payload.model);
  formData.append('targetModel', payload.targetModel);
  formData.append('image', file);

  const response = await fetch('/api/image-to-prompt', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as ImageToPromptResponse;
}

export async function fetchUsage(payload: UsageRequestPayload): Promise<UsageResponse> {
  const response = await fetch('/api/usage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as UsageResponse;
}

export async function fetchPromptReference(): Promise<PromptReferenceResponse> {
  const response = await fetch('/api/prompt-reference');

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as PromptReferenceResponse;
}

export function isApiErrorState(value: unknown): value is ApiErrorState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.message === 'string';
}

export function formatMetric(value: number | undefined, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }

  return value.toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function createUploadPreviewStateFromFiles(files: File[]): UploadState {
  return {
    files,
    previewUrls: files.map((file) => URL.createObjectURL(file)),
    error: null,
  };
}

export async function createFileFromDataUrl(
  dataUrl: string,
  filename: string,
): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  return new File([blob], filename, {
    type: blob.type || 'image/png',
    lastModified: Date.now(),
  });
}

export function filterPromptReferenceItems(
  items: PromptReferenceItem[],
  selectedCategory: string,
  searchQuery: string,
): PromptReferenceItem[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return items.filter((item) => {
    if (selectedCategory !== '全部' && item.category !== selectedCategory) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      item.title,
      item.content,
      item.category,
      item.source,
      ...item.tags,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export function getPromptReferenceCategories(items: PromptReferenceItem[]): string[] {
  const seen = new Set<string>();

  for (const item of items) {
    if (item.category.trim()) {
      seen.add(item.category.trim());
    }
  }

  return ['全部', ...Array.from(seen)];
}
