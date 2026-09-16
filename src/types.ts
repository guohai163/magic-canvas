export type SupportedModel =
  | 'gemini-3.1-flash-image'
  | 'gpt-image-2'
  | 'gpt-5.6-luna'
  | 'gpt-5.6-terra'
  | 'gpt-image-2.5-sunburst'
  | 'gpt-image-2.5-flare';

export type ApiProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  supportedModels: SupportedModel[];
};

export type AspectRatio = '1:1' | '3:2' | '2:3' | '16:9' | '9:16';

export type ImageSizePreset = '1K' | '2K' | '4K';

export type ImageFormState = {
  baseUrl: string;
  apiKey: string;
  model: SupportedModel;
  apiProviders: ApiProviderConfig[];
  prompt: string;
  negativePrompt: string;
  stylePreset: StylePresetId;
  sizeMode: 'preset' | 'custom';
  aspectRatio: AspectRatio;
  imageSize: ImageSizePreset;
  size: string;
  customWidth: string;
  customHeight: string;
  quality: 'low' | 'medium' | 'high' | 'auto';
  generationMode: 'text' | 'reference' | 'edit';
};

export type StylePresetId =
  | 'none'
  | 'realistic'
  | 'illustration'
  | 'anime'
  | 'three-d'
  | 'cyberpunk';

export type GenerationHistoryItem = {
  id: string;
  createdAt: string;
  prompt: string;
  stylePreset?: StylePresetId;
  requestedSize?: string;
  quality?: ImageFormState['quality'];
  width: number;
  height: number;
  imageDataUrl: string;
  filename: string;
  operation?: 'generate' | 'region-edit' | 'outpaint';
  parentId?: string;
  model?: SupportedModel;
  negativePrompt?: string;
};

export type ApiErrorState = {
  status?: number;
  message: string;
  details?: string;
};

export type GeneratedImage = GenerationHistoryItem;

export type AspectRatioPreset = {
  label: AspectRatio;
  value: AspectRatio;
  ratioLabel: string;
};

export type ImageSizeOption = {
  label: ImageSizePreset;
  value: ImageSizePreset;
  description: string;
};

export type StylePreset = {
  id: StylePresetId;
  label: string;
  promptHint: string;
  promptTemplate: string;
  swatch: string;
  previewImage?: string;
};

export type PromptReferenceItem = {
  id: string;
  title: string;
  category: string;
  content: string;
  images: string[];
  tags: string[];
  source: string;
  sourceUrl: string;
};

export type PromptReferenceResponse = {
  items: PromptReferenceItem[];
  sourceLabel: string;
};

export type UsageResponse = {
  isValid?: boolean;
  mode?: string;
  planName?: string;
  remaining?: number;
  unit?: string;
  subscription?: {
    daily_limit_usd?: number;
    daily_usage_usd?: number;
    weekly_limit_usd?: number;
    weekly_usage_usd?: number;
    monthly_limit_usd?: number;
    monthly_usage_usd?: number;
    expires_at?: string;
  };
  usage?: {
    average_duration_ms?: number;
    rpm?: number;
    tpm?: number;
    today?: {
      actual_cost?: number;
      cost?: number;
      requests?: number;
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
    total?: {
      actual_cost?: number;
      cost?: number;
      requests?: number;
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  };
};

export type UsageState = {
  data: UsageResponse | null;
  isLoading: boolean;
  error: ApiErrorState | null;
  updatedAt: string | null;
};

export type GenerateRequestPayload = {
  baseUrl: string;
  apiKey: string;
  model: SupportedModel;
  prompt: string;
  negativePrompt: string;
  sizeMode: ImageFormState['sizeMode'];
  size: string;
  aspectRatio: AspectRatio;
  imageSize: ImageSizePreset;
  quality: ImageFormState['quality'];
  mode?: 'text' | 'reference' | 'edit';
};

export type GenerateResponse = {
  data?: Array<{
    b64_json?: string;
    width?: number;
    height?: number;
  }>;
};

export type EditorSource = {
  id?: string;
  imageDataUrl: string;
  filename: string;
  prompt: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
};

export type RegionEditRequestPayload = {
  baseUrl: string;
  apiKey: string;
  model: SupportedModel;
  prompt: string;
  negativePrompt: string;
  quality: ImageFormState['quality'];
  width: number;
  height: number;
  feather: number;
  image: Blob;
  mask: Blob;
};

export type PromptPolishRequestPayload = {
  baseUrl: string;
  apiKey: string;
  model: SupportedModel;
  prompt: string;
  stylePreset: ImageFormState['stylePreset'];
  generationMode: ImageFormState['generationMode'];
  size: string;
  quality: ImageFormState['quality'];
};

export type PromptPolishResponse = {
  polishedPrompt: string;
};

export type ImageToPromptRequestPayload = {
  baseUrl: string;
  apiKey: string;
  model: SupportedModel;
  targetModel: SupportedModel;
};

export type ImageToPromptResponse = {
  prompt: string;
};

export type UsageRequestPayload = {
  baseUrl: string;
  apiKey: string;
};

export type UploadState = {
  files: File[];
  previewUrls: string[];
  error: string | null;
};

export type AppPage = 'ai-image' | 'region-editor' | 'image-to-prompt' | 'prompt-plaza' | 'settings';

export type DisplayLanguage = 'zh' | 'en';

export type ThemeMode = 'light' | 'dark';

export type DisplayPreferences = {
  language: DisplayLanguage;
  theme: ThemeMode;
};
