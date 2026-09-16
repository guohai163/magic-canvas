import type {
  AspectRatioPreset,
  DisplayPreferences,
  ImageFormState,
  ImageSizeOption,
  StylePreset,
  SupportedModel,
} from './types';

export const STORAGE_KEYS = {
  settings: 'image-gen:settings',
  history: 'image-gen:history',
  preferences: 'image-gen:preferences',
  favorites: 'image-gen:favorites',
} as const;

export const INDEXED_DB = {
  name: 'image-gen-db',
  version: 1,
  store: 'kv',
  historyKey: 'history',
} as const;

export const SUPPORTED_MODELS: SupportedModel[] = [
  'gemini-3.1-flash-image',
  'gpt-image-2',
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
];

export const IMAGE_GENERATION_MODELS: SupportedModel[] = [
  'gemini-3.1-flash-image',
  'gpt-image-2',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
];

export const DEFAULT_FORM_STATE: ImageFormState = {
  baseUrl: '',
  apiKey: '',
  model: 'gpt-image-2',
  apiProviders: [],
  prompt: '',
  negativePrompt: '',
  stylePreset: 'none',
  sizeMode: 'preset',
  aspectRatio: '3:2',
  imageSize: '1K',
  size: '1536x1024',
  customWidth: '1920',
  customHeight: '1024',
  quality: 'medium',
  generationMode: 'text',
};

export const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
  { label: '1:1', ratioLabel: '方图', value: '1:1' },
  { label: '3:2', ratioLabel: '横版', value: '3:2' },
  { label: '2:3', ratioLabel: '竖版', value: '2:3' },
  { label: '16:9', ratioLabel: '宽屏', value: '16:9' },
  { label: '9:16', ratioLabel: '手机竖图', value: '9:16' },
];

export const IMAGE_SIZE_OPTIONS: ImageSizeOption[] = [
  { label: '1K', value: '1K', description: '标准' },
  { label: '2K', value: '2K', description: '高清' },
  { label: '4K', value: '4K', description: '超清' },
];

export const CUSTOM_SIZE_LIMITS = {
  minPixels: 655_360,
  maxPixels: 8_294_400,
  maxLongEdge: 3840,
  minShortEdge: 256,
  step: 16,
  maxRatio: 3,
} as const;

export const QUALITY_OPTIONS: Array<{
  label: string;
  value: ImageFormState['quality'];
}> = [
  { label: '自动', value: 'auto' },
  { label: '快速', value: 'low' },
  { label: '标准', value: 'medium' },
  { label: '高清', value: 'high' },
];

export const HISTORY_LIMIT = 10;
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'none',
    label: '无风格',
    promptHint: '保持自由创作',
    promptTemplate: '',
    swatch: 'linear-gradient(135deg, #f6f1ff 0%, #ebe6ff 100%)',
    previewImage: '/style-presets/none.png',
  },
  {
    id: 'realistic',
    label: '写实',
    promptHint: '细节真实、电影感',
    promptTemplate: '在不改变主体、场景和构图核心设定的前提下，采用高质量写实摄影风格。强调真实光影、自然色彩、可信材质、清晰层次、镜头景深、空间透视与电影感布光，让整体画面更接近专业照片质感。避免插画笔触、卡通线稿、动漫上色和夸张变形。',
    swatch: 'linear-gradient(135deg, #6d7d91 0%, #c7d2dd 100%)',
    previewImage: '/style-presets/realistic.png',
  },
  {
    id: 'illustration',
    label: '插画',
    promptHint: '柔和笔触、叙事感',
    promptTemplate: '在不改变主体、场景和构图核心设定的前提下，采用高质量数字插画风格。强调柔和且有设计感的笔触、清晰的造型概括、层次分明的色块、叙事感光影与统一的画面配色，让整体更具艺术表现力和故事氛围。弱化真实摄影感，避免写实照片质感。',
    swatch: 'linear-gradient(135deg, #c58f52 0%, #f2d2a6 100%)',
    previewImage: '/style-presets/illustration.png',
  },
  {
    id: 'anime',
    label: '动漫',
    promptHint: '高饱和、角色感',
    promptTemplate: '在不改变主体、场景和构图核心设定的前提下，采用高质量日系动漫风格。强调干净利落的轮廓线、明亮且高饱和的配色、清晰的赛璐璐光影、富有张力的镜头语言与动画海报般的视觉完成度。避免真实摄影质感、厚重写实纹理和复杂笔触。',
    swatch: 'linear-gradient(135deg, #6c73ff 0%, #ff9fd3 100%)',
    previewImage: '/style-presets/anime.png',
  },
  {
    id: 'three-d',
    label: '3D渲染',
    promptHint: '体积光、材质细腻',
    promptTemplate: '在不改变主体、场景和构图核心设定的前提下，采用高质量 3D 渲染风格。强调立体结构、真实材质反射、干净边缘、体积光、环境遮蔽、空间景深与精细建模带来的 CG 质感，让画面呈现高级三维视觉效果。避免 2D 平面化表现和手绘笔触。',
    swatch: 'linear-gradient(135deg, #3546ff 0%, #8de0ff 100%)',
    previewImage: '/style-presets/three-d.png',
  },
  {
    id: 'cyberpunk',
    label: '赛博朋克',
    promptHint: '霓虹、未来都市',
    promptTemplate: '在不改变主体、场景和构图核心设定的前提下，采用强烈赛博朋克风格。强调霓虹灯光、未来科技氛围、冷暖对比、高反差色彩、电子辉光、潮湿反射与都市夜景能量感，让整体呈现鲜明的未来视觉风格。避免普通柔和插画气质和低对比画面。',
    swatch: 'linear-gradient(135deg, #2f1d73 0%, #ff4fd8 100%)',
    previewImage: '/style-presets/cyberpunk.png',
  },
];

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  language: 'zh',
  theme: 'light',
};
