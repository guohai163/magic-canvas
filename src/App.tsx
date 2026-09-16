import { lazy, Suspense, type FormEvent, startTransition, useEffect, useState } from 'react';
import { ConfigForm } from './components/ConfigForm';
import { ImageToPromptPage } from './components/ImageToPromptPage';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import type { RegionEditorSubmission } from './components/ImageEditorPage';
import { PromptReference } from './components/PromptReference';
import { ResultPanel } from './components/ResultPanel';
import { SettingsPanel } from './components/SettingsPanel';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DEFAULT_FORM_STATE,
  HISTORY_LIMIT,
  IMAGE_GENERATION_MODELS,
  SUPPORTED_MODELS,
} from './constants';
import {
  clearHistory,
  clearStoredSettings,
  loadDisplayPreferences,
  loadFavoriteHistoryIds,
  loadHistory,
  loadStoredSettings,
  saveDisplayPreferences,
  saveFavoriteHistoryIds,
  saveHistory,
  saveStoredSettings,
} from './storage';
import type {
  ApiErrorState,
  ApiProviderConfig,
  AppPage,
  DisplayLanguage,
  GeneratedImage,
  EditorSource,
  GenerationHistoryItem,
  ImageFormState,
  PromptReferenceItem,
  SupportedModel,
  ThemeMode,
  UploadState,
  UsageState,
} from './types';
import {
  buildSubmissionPrompt,
  createHistoryItem,
  createDownloadFilename,
  createImageDataUrl,
  createFileFromDataUrl,
  createUploadPreviewStateFromFiles,
  fetchPromptReference,
  fetchUsage,
  findApiProviderForModel,
  filterPromptReferenceItems,
  getResolvedSize,
  getPromptReferenceCategories,
  isApiErrorState,
  requestGenerate,
  requestImageToPrompt,
  requestGenerateWithEditImage,
  requestGenerateWithReferenceImages,
  requestPromptPolish,
  requestRegionEdit,
  resolveApiConfigForModel,
  resolveApiConfigForPreferredModels,
  validateForm,
  validateUploadFiles,
} from './utils';
import { createEditorSourceFromFile } from './editor-utils';

const PROMPT_POLISH_MODELS: SupportedModel[] = ['gpt-5.6-terra', 'gpt-5.6-luna'];
const IMAGE_TO_PROMPT_MODELS: SupportedModel[] = ['gpt-5.6-terra', 'gpt-5.6-luna'];
const ImageEditorPage = lazy(() => import('./components/ImageEditorPage').then((module) => ({
  default: module.ImageEditorPage,
})));

function isImageGenerationModel(model: SupportedModel): boolean {
  return IMAGE_GENERATION_MODELS.includes(model);
}

function findFirstConfiguredImageGenerationModel(providers: ApiProviderConfig[]): SupportedModel | undefined {
  return IMAGE_GENERATION_MODELS.find((model) =>
    providers.some((provider) => provider.supportedModels.includes(model)),
  );
}

const NAV_ITEMS: Array<{
  id: AppPage;
  icon: string;
  title: { zh: string; en: string };
  description: { zh: string; en: string };
}> = [
  {
    id: 'ai-image',
    icon: '✦',
    title: { zh: 'Ai生图', en: 'AI Image' },
    description: { zh: '通过 GPT Image 接口生成高质量图片', en: 'Create premium visuals with GPT Image' },
  },
  {
    id: 'image-to-prompt',
    icon: '◧',
    title: { zh: '图转提示词', en: 'Image To Prompt' },
    description: { zh: '上传一张图片，生成适合 GPT Image 的提示词', en: 'Upload one image and derive a GPT Image prompt' },
  },
  {
    id: 'region-editor',
    icon: '◩',
    title: { zh: '局部编辑', en: 'Region Editor' },
    description: { zh: '涂抹选区进行局部重绘或扩展画布', en: 'Paint a selection to edit or extend an image' },
  },
  {
    id: 'prompt-plaza',
    icon: '◫',
    title: { zh: '提示词参考', en: 'Prompt Reference' },
    description: { zh: '复用外部提示词库，一键带回创作页', en: 'Browse external prompt references and jump back to create' },
  },
  {
    id: 'settings',
    icon: '⚙',
    title: { zh: '设置', en: 'Settings' },
    description: { zh: '管理接口配置、用量与安全提示', en: 'Manage credentials, usage and security notes' },
  },
];

function App() {
  const [activePage, setActivePage] = useState<AppPage>('ai-image');
  const [formState, setFormState] = useState<ImageFormState>(() => loadStoredSettings());
  const [history, setHistory] = useState<GenerationHistoryItem[]>([]);
  const [currentImage, setCurrentImage] = useState<GeneratedImage | null>(null);
  const [currentBatch, setCurrentBatch] = useState<GeneratedImage[]>([]);
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const [editorSource, setEditorSource] = useState<EditorSource | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolishingPrompt, setIsPolishingPrompt] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState<ApiErrorState | null>(null);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [polishedPromptDraft, setPolishedPromptDraft] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({
    files: [],
    previewUrls: [],
    error: null,
  });
  const [imageToPromptUploadState, setImageToPromptUploadState] = useState<UploadState>({
    files: [],
    previewUrls: [],
    error: null,
  });
  const [isGeneratingPromptFromImage, setIsGeneratingPromptFromImage] = useState(false);
  const [imageToPromptError, setImageToPromptError] = useState<string | null>(null);
  const [generatedPromptFromImageDraft, setGeneratedPromptFromImageDraft] = useState<string | null>(null);
  const [usageState, setUsageState] = useState<UsageState>({
    data: null,
    isLoading: false,
    error: null,
    updatedAt: null,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preferences, setPreferences] = useState(() => loadDisplayPreferences());
  const [favoriteHistoryIds, setFavoriteHistoryIds] = useState<string[]>(() => loadFavoriteHistoryIds());
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [promptReferenceItems, setPromptReferenceItems] = useState<PromptReferenceItem[]>([]);
  const [promptReferenceSourceLabel, setPromptReferenceSourceLabel] = useState('ZeroLu/awesome-gpt-image');
  const [promptReferenceLoading, setPromptReferenceLoading] = useState(false);
  const [promptReferenceError, setPromptReferenceError] = useState<string | null>(null);
  const [promptReferenceSearch, setPromptReferenceSearch] = useState('');
  const [promptReferenceCategory, setPromptReferenceCategory] = useState('全部');

  useEffect(() => {
    saveStoredSettings(formState);
  }, [formState]);

  useEffect(() => {
    saveDisplayPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    saveFavoriteHistoryIds(favoriteHistoryIds);
  }, [favoriteHistoryIds]);

  useEffect(() => {
    let cancelled = false;

    void loadHistory().then((loadedHistory) => {
      if (!cancelled) {
        setHistory(loadedHistory);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const previewUrl of uploadState.previewUrls) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [uploadState.previewUrls]);

  useEffect(() => {
    return () => {
      for (const previewUrl of imageToPromptUploadState.previewUrls) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [imageToPromptUploadState.previewUrls]);

  useEffect(() => {
    const generateConfig = resolveApiConfigForModel(formState, formState.model);
    if (!generateConfig.baseUrl || !generateConfig.apiKey) {
      return;
    }

    void refreshUsage();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopyFeedback(null);
    }, 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copyFeedback]);

  useEffect(() => {
    setPromptReferenceLoading(true);
    setPromptReferenceError(null);

    void fetchPromptReference()
      .then((result) => {
        setPromptReferenceItems(result.items);
        setPromptReferenceSourceLabel(result.sourceLabel);
      })
      .catch((caughtError) => {
        setPromptReferenceError(
          isApiErrorState(caughtError)
            ? caughtError.message
            : caughtError instanceof Error
              ? caughtError.message
              : '提示词参考加载失败。',
        );
      })
      .finally(() => {
        setPromptReferenceLoading(false);
      });
  }, []);

  function syncCurrentApiFields(
    current: ImageFormState,
    providers: ApiProviderConfig[],
    model: SupportedModel,
  ): Pick<ImageFormState, 'baseUrl' | 'apiKey' | 'model' | 'apiProviders'> {
    if (providers.length === 0) {
      return {
        apiProviders: providers,
        model: isImageGenerationModel(model) ? model : DEFAULT_FORM_STATE.model,
        baseUrl: current.baseUrl,
        apiKey: current.apiKey,
      };
    }

    const selectedProvider = isImageGenerationModel(model) ? findApiProviderForModel(providers, model) : undefined;
    const fallbackModel = findFirstConfiguredImageGenerationModel(providers) ?? DEFAULT_FORM_STATE.model;
    const nextModel = selectedProvider ? model : fallbackModel;
    const nextProvider = findApiProviderForModel(providers, nextModel);

    return {
      apiProviders: providers,
      model: nextModel,
      baseUrl: nextProvider?.baseUrl ?? (providers.length > 0 ? '' : current.baseUrl),
      apiKey: nextProvider?.apiKey ?? (providers.length > 0 ? '' : current.apiKey),
    };
  }

  function updateField<K extends keyof ImageFormState>(field: K, value: ImageFormState[K]) {
    if (field === 'generationMode') {
      setUploadState((current) => {
        const nextMode = value as ImageFormState['generationMode'];
        if (nextMode === 'text') {
          for (const previewUrl of current.previewUrls) {
            URL.revokeObjectURL(previewUrl);
          }

          return {
            files: [],
            previewUrls: [],
            error: null,
          };
        }

        if (nextMode === 'edit' && current.files.length > 1) {
          const [firstFile] = current.files;
          const [firstPreviewUrl] = current.previewUrls;

          for (const previewUrl of current.previewUrls.slice(1)) {
            URL.revokeObjectURL(previewUrl);
          }

          return {
            files: firstFile ? [firstFile] : [],
            previewUrls: firstPreviewUrl ? [firstPreviewUrl] : [],
            error: null,
          };
        }

        const nextError = validateUploadFiles(current.files, nextMode);
        return {
          ...current,
          error: nextError,
        };
      });
    }

    if (field === 'model') {
      setFormState((current) => ({
        ...current,
        ...syncCurrentApiFields(
          current,
          current.apiProviders,
          value as ImageFormState['model'],
        ),
      }));
      return;
    }

    if (field === 'apiProviders') {
      setFormState((current) => ({
        ...current,
        ...syncCurrentApiFields(
          current,
          value as ApiProviderConfig[],
          current.model,
        ),
      }));
      return;
    }

    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function clearActiveApiKey() {
    setFormState((current) => {
      const selectedProvider = findApiProviderForModel(current.apiProviders, current.model);
      if (!selectedProvider) {
        return {
          ...current,
          apiKey: '',
        };
      }

      const nextProviders = current.apiProviders.map((provider) =>
        provider.id === selectedProvider.id
          ? {
              ...provider,
              apiKey: '',
            }
          : provider,
      );

      return {
        ...current,
        ...syncCurrentApiFields(current, nextProviders, current.model),
      };
    });
  }

  function clearUploadState() {
    setUploadState((current) => {
      for (const previewUrl of current.previewUrls) {
        URL.revokeObjectURL(previewUrl);
      }

      return {
        files: [],
        previewUrls: [],
        error: null,
      };
    });
  }

  function clearImageToPromptUploadState() {
    setImageToPromptUploadState((current) => {
      for (const previewUrl of current.previewUrls) {
        URL.revokeObjectURL(previewUrl);
      }

      return {
        files: [],
        previewUrls: [],
        error: null,
      };
    });
  }

  function resetCreativeFields() {
    setError(null);
    setPolishError(null);
    setPolishedPromptDraft(null);
    clearUploadState();
    setFormState((current) => ({
      ...current,
      prompt: '',
      negativePrompt: '',
      stylePreset: DEFAULT_FORM_STATE.stylePreset,
      sizeMode: DEFAULT_FORM_STATE.sizeMode,
      aspectRatio: DEFAULT_FORM_STATE.aspectRatio,
      imageSize: DEFAULT_FORM_STATE.imageSize,
      size: DEFAULT_FORM_STATE.size,
      customWidth: DEFAULT_FORM_STATE.customWidth,
      customHeight: DEFAULT_FORM_STATE.customHeight,
      quality: DEFAULT_FORM_STATE.quality,
      generationMode: DEFAULT_FORM_STATE.generationMode,
    }));
  }

  function handleClearConfig() {
    clearStoredSettings();
    setShowApiKey(false);
    setPolishError(null);
    setPolishedPromptDraft(null);
    setFormState(DEFAULT_FORM_STATE);
    clearUploadState();
    setUsageState({
      data: null,
      isLoading: false,
      error: null,
      updatedAt: null,
    });
    setPreferences(DEFAULT_DISPLAY_PREFERENCES);
    setAdvancedOpen(false);
    setImageToPromptError(null);
    setGeneratedPromptFromImageDraft(null);
    clearImageToPromptUploadState();
  }

  function handleClearHistory() {
    void clearHistory();
    setHistory([]);
    setFavoriteHistoryIds([]);
    setCurrentImage(null);
    setCurrentBatch([]);
    setPreviewImage(null);
  }

  function handleSelectHistory(item: GenerationHistoryItem) {
    startTransition(() => {
      setActivePage('ai-image');
      setCurrentImage(item);
      setCurrentBatch([item]);
      setError(null);
      clearUploadState();
      setFormState((current) => ({
        ...current,
        prompt: item.prompt,
        stylePreset: item.stylePreset ?? current.stylePreset,
        sizeMode: item.width > 0 && item.height > 0 ? 'custom' : current.sizeMode,
        size: item.width > 0 && item.height > 0 ? `${item.width}x${item.height}` : current.size,
        customWidth: item.width > 0 ? String(item.width) : current.customWidth,
        customHeight: item.height > 0 ? String(item.height) : current.customHeight,
      }));
    });
  }

  async function handleReuseImageForEdit(item: GeneratedImage) {
    try {
      const nextFile = await createFileFromDataUrl(
        item.imageDataUrl,
        item.filename || `edit-source-${item.id}.png`,
      );

      setError(null);
      setPolishError(null);
      setPolishedPromptDraft(null);
      setPreviewImage(null);
      setCurrentImage(item);
      setCurrentBatch([item]);
      setActivePage('ai-image');
      setFormState((current) => ({
        ...current,
        generationMode: 'edit',
        prompt: item.prompt || current.prompt,
        stylePreset: item.stylePreset ?? current.stylePreset,
        sizeMode: item.width > 0 && item.height > 0 ? 'custom' : current.sizeMode,
        size: item.width > 0 && item.height > 0 ? `${item.width}x${item.height}` : current.size,
        customWidth: item.width > 0 ? String(item.width) : current.customWidth,
        customHeight: item.height > 0 ? String(item.height) : current.customHeight,
      }));
      setUploadState((current) => {
        for (const previewUrl of current.previewUrls) {
          URL.revokeObjectURL(previewUrl);
        }

        return createUploadPreviewStateFromFiles([nextFile]);
      });
    } catch (caughtError) {
      setError({
        message:
          caughtError instanceof Error
            ? `载入待编辑图片失败：${caughtError.message}`
            : '载入待编辑图片失败，请重试。',
      });
    }
  }

  async function handleOpenRegionEditor(item: GeneratedImage) {
    try {
      const sourceFile = await createFileFromDataUrl(
        item.imageDataUrl,
        item.filename || `editor-source-${item.id}.png`,
      );
      const nextSource = await createEditorSourceFromFile(sourceFile);
      setEditorSource({
        ...nextSource,
        id: item.id,
        prompt: item.prompt,
      });
      setPreviewImage(null);
      setActivePage('region-editor');
    } catch (caughtError) {
      setError({
        message: caughtError instanceof Error ? caughtError.message : '无法载入局部编辑图片。',
      });
    }
  }

  async function handleRegionEditorGenerate(submission: RegionEditorSubmission): Promise<GeneratedImage> {
    const apiConfig = resolveApiConfigForModel(formState, submission.model);
    if (!apiConfig.baseUrl || !apiConfig.apiKey) {
      throw { message: `模型 ${submission.model} 尚未绑定可用接口。` } satisfies ApiErrorState;
    }
    const response = await requestRegionEdit({
      baseUrl: apiConfig.baseUrl,
      apiKey: apiConfig.apiKey,
      model: submission.model,
      prompt: submission.prompt,
      negativePrompt: submission.negativePrompt,
      quality: submission.quality,
      width: submission.width,
      height: submission.height,
      feather: submission.feather,
      image: submission.image,
      mask: submission.mask,
    });
    const imageResult = response.data?.find((item) => typeof item.b64_json === 'string');
    if (!imageResult?.b64_json) {
      throw { message: '返回数据不完整，未找到局部编辑图片。' } satisfies ApiErrorState;
    }
    const createdAt = new Date();
    return {
      id: `${createdAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: createdAt.toISOString(),
      prompt: submission.prompt,
      requestedSize: `${submission.width}x${submission.height}`,
      quality: submission.quality,
      width: imageResult.width ?? submission.width,
      height: imageResult.height ?? submission.height,
      imageDataUrl: createImageDataUrl(imageResult.b64_json),
      filename: createDownloadFilename(createdAt),
      operation: submission.operation,
      parentId: submission.parentId,
      model: submission.model,
      negativePrompt: submission.negativePrompt,
    };
  }

  async function handleSaveEditorResult(image: GeneratedImage) {
    const nextHistory = [image, ...history.filter((item) => item.id !== image.id)].slice(0, HISTORY_LIMIT);
    const persistedHistory = await saveHistory(nextHistory);
    setHistory(persistedHistory);
    setCurrentImage(image);
    setCurrentBatch([image]);
  }

  function handleApplyPrompt(item: PromptReferenceItem) {
    setActivePage('ai-image');
    setPolishError(null);
    setPolishedPromptDraft(null);
    setFormState((current) => ({
      ...current,
      prompt: item.content,
    }));
  }

  function handleImageToPromptImageSelect(fileList: FileList | File[] | null) {
    const incomingFiles = fileList ? Array.from(fileList).slice(0, 1) : [];

    setImageToPromptUploadState((current) => {
      if (incomingFiles.length === 0) {
        return current;
      }

      const uploadError = validateUploadFiles(incomingFiles, 'edit');
      if (uploadError) {
        return {
          ...current,
          error: uploadError,
        };
      }

      for (const previewUrl of current.previewUrls) {
        URL.revokeObjectURL(previewUrl);
      }

      return createUploadPreviewStateFromFiles(incomingFiles);
    });
    setImageToPromptError(null);
    setGeneratedPromptFromImageDraft(null);
  }

  function handleImageSelect(fileList: FileList | File[] | null) {
    const incomingFiles = fileList ? Array.from(fileList) : [];

    setUploadState((current) => {
      if (incomingFiles.length === 0) {
        return current;
      }

      const nextFiles =
        formState.generationMode === 'reference'
          ? [...current.files, ...incomingFiles]
          : incomingFiles.slice(0, 1);
      const uploadError = validateUploadFiles(nextFiles, formState.generationMode);

      if (uploadError) {
        return {
          ...current,
          error: uploadError,
        };
      }

      for (const previewUrl of current.previewUrls) {
        URL.revokeObjectURL(previewUrl);
      }

      return createUploadPreviewStateFromFiles(nextFiles);
    });
  }

  function handleRemoveImage(index: number) {
    setUploadState((current) => {
      const nextFiles = current.files.filter((_, fileIndex) => fileIndex !== index);
      const nextPreviewUrls = current.previewUrls.filter((_, fileIndex) => fileIndex !== index);
      const removedPreviewUrl = current.previewUrls[index];

      if (removedPreviewUrl) {
        URL.revokeObjectURL(removedPreviewUrl);
      }

      const nextError = validateUploadFiles(nextFiles, formState.generationMode);
      return {
        files: nextFiles,
        previewUrls: nextPreviewUrls,
        error: nextError,
      };
    });
  }

  async function handleGeneratePromptFromImage() {
    const imageFile = imageToPromptUploadState.files[0];
    if (!imageFile) {
      return;
    }

    setImageToPromptError(null);
    setGeneratedPromptFromImageDraft(null);
    setIsGeneratingPromptFromImage(true);

    try {
      const imageToPromptConfig = resolveApiConfigForPreferredModels(formState, IMAGE_TO_PROMPT_MODELS);
      const result = await requestImageToPrompt({
        baseUrl: imageToPromptConfig.baseUrl,
        apiKey: imageToPromptConfig.apiKey,
        model: imageToPromptConfig.model,
        targetModel: formState.model,
      }, imageFile);

      setGeneratedPromptFromImageDraft(result.prompt);
    } catch (caughtError) {
      const nextError = isApiErrorState(caughtError)
        ? caughtError.message
        : caughtError instanceof Error
          ? caughtError.message
          : '图转提示词失败，请检查当前配置后重试。';
      setImageToPromptError(nextError);
    } finally {
      setIsGeneratingPromptFromImage(false);
    }
  }

  function handleApplyGeneratedPromptFromImage() {
    if (!generatedPromptFromImageDraft) {
      return;
    }

    setFormState((current) => ({
      ...current,
      prompt: generatedPromptFromImageDraft,
    }));
    setGeneratedPromptFromImageDraft(null);
    setImageToPromptError(null);
    setActivePage('ai-image');
  }

  function handleDismissGeneratedPromptFromImage() {
    setGeneratedPromptFromImageDraft(null);
    setImageToPromptError(null);
  }

  async function refreshUsage() {
    const generateConfig = resolveApiConfigForModel(formState, formState.model);
    const baseUrl = generateConfig.baseUrl;
    const apiKey = generateConfig.apiKey;

    if (!baseUrl || !apiKey) {
      setUsageState({
        data: null,
        isLoading: false,
        error: null,
        updatedAt: null,
      });
      return;
    }

    setUsageState((current) => ({
      ...current,
      isLoading: true,
      error: null,
    }));

    try {
      const data = await fetchUsage({ baseUrl, apiKey });
      setUsageState({
        data,
        isLoading: false,
        error: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (caughtError) {
      const nextError = isApiErrorState(caughtError)
        ? caughtError
        : {
            message: '用量请求失败，请检查接口域名、Key 或跨域配置。',
            details: caughtError instanceof Error ? caughtError.message : undefined,
          };

      setUsageState((current) => ({
        ...current,
        isLoading: false,
        error: nextError,
      }));
    }
  }

  async function runGenerateRequest() {
    const resolvedSize = getResolvedSize(formState);
    const submittedPrompt = buildSubmissionPrompt(formState);
    const generateConfig = resolveApiConfigForModel(formState, formState.model);
    const payloadData = {
      baseUrl: generateConfig.baseUrl,
      apiKey: generateConfig.apiKey,
      model: generateConfig.model,
      prompt: submittedPrompt,
      negativePrompt: formState.negativePrompt.trim(),
      sizeMode: formState.sizeMode,
      size: resolvedSize,
      aspectRatio: formState.aspectRatio,
      imageSize: formState.imageSize,
      quality: formState.quality,
      mode: formState.generationMode,
    } as const;

    return formState.generationMode === 'reference' && uploadState.files.length > 0
      ? requestGenerateWithReferenceImages(payloadData, uploadState.files)
      : formState.generationMode === 'edit' && uploadState.files[0]
        ? requestGenerateWithEditImage(payloadData, uploadState.files[0])
        : requestGenerate(payloadData);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPolishError(null);
    setCopyFeedback(null);

    const validationMessage = validateForm(formState);
    if (validationMessage) {
      setError({ message: validationMessage });
      return;
    }

    if (uploadState.error) {
      setError({ message: uploadState.error });
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = await runGenerateRequest();
      const imageResults = payload.data?.filter((item) => typeof item?.b64_json === 'string') ?? [];

      if (imageResults.length === 0) {
        setError({
          message: '返回数据不完整，未找到图片内容。',
        });
        return;
      }

      const createdAt = new Date();
      const nextImages = imageResults.map((imageResult) =>
        createHistoryItem(
          formState,
          createImageDataUrl(imageResult.b64_json as string),
          {
            width: imageResult?.width,
            height: imageResult?.height,
          },
          createdAt,
        ),
      );
      const nextHistory = [...nextImages, ...history].slice(0, HISTORY_LIMIT);
      const persistedHistory = await saveHistory(nextHistory);

      setCurrentImage(nextImages[0] ?? null);
      setCurrentBatch(nextImages);
      setHistory(persistedHistory);
      void refreshUsage();
    } catch (caughtError) {
      const nextError = isApiErrorState(caughtError)
        ? caughtError
        : {
            message: '网络请求失败，请检查本地服务是否启动，或确认接口域名与 Key 配置是否正确。',
            details: caughtError instanceof Error ? caughtError.message : undefined,
          };
      setError(nextError);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePolishPrompt() {
    if (!formState.prompt.trim()) {
      return;
    }

    setPolishError(null);
    setPolishedPromptDraft(null);
    setIsPolishingPrompt(true);

    try {
      const promptPolishConfig = resolveApiConfigForPreferredModels(formState, PROMPT_POLISH_MODELS);
      const result = await requestPromptPolish({
        baseUrl: promptPolishConfig.baseUrl,
        apiKey: promptPolishConfig.apiKey,
        model: promptPolishConfig.model,
        prompt: formState.prompt.trim(),
        stylePreset: formState.stylePreset,
        generationMode: formState.generationMode,
        size: getResolvedSize(formState),
        quality: formState.quality,
      });

      setPolishedPromptDraft(result.polishedPrompt);
    } catch (caughtError) {
      const nextError = isApiErrorState(caughtError)
        ? caughtError.message
        : caughtError instanceof Error
          ? caughtError.message
          : 'AI 润色失败，请检查当前配置后重试。';
      setPolishError(nextError);
    } finally {
      setIsPolishingPrompt(false);
    }
  }

  function handleApplyPolishedPrompt() {
    if (!polishedPromptDraft) {
      return;
    }

    setFormState((current) => ({
      ...current,
      prompt: polishedPromptDraft,
    }));
    setPolishedPromptDraft(null);
    setPolishError(null);
  }

  function handleDismissPolishedPrompt() {
    setPolishedPromptDraft(null);
    setPolishError(null);
  }

  async function handleCopyCurrentImage() {
    if (!currentImage) {
      return;
    }

    try {
      await navigator.clipboard.writeText(currentImage.imageDataUrl);
      setCopyFeedback('已复制当前图片 data URL。');
    } catch {
      setCopyFeedback('复制失败，请检查浏览器剪贴板权限。');
    }
  }

  function handleToggleFavorite() {
    if (!currentImage) {
      return;
    }

    setFavoriteHistoryIds((current) =>
      current.includes(currentImage.id)
        ? current.filter((id) => id !== currentImage.id)
        : [currentImage.id, ...current],
    );
  }

  function handleRegenerate() {
    const form = document.querySelector<HTMLFormElement>('.config-form');
    form?.requestSubmit();
  }

  function toggleLanguage() {
    setPreferences((current) => ({
      ...current,
      language: current.language === 'zh' ? 'en' : 'zh',
    }));
  }

  function toggleTheme() {
    setPreferences((current) => ({
      ...current,
      theme: current.theme === 'light' ? 'dark' : 'light',
    }));
  }

  const activeNav = NAV_ITEMS.find((item) => item.id === activePage) ?? NAV_ITEMS[0];
  const language: DisplayLanguage = preferences.language;
  const theme: ThemeMode = preferences.theme;
  const promptReferenceCategories = getPromptReferenceCategories(promptReferenceItems);
  const filteredPromptReferenceItems = filterPromptReferenceItems(
    promptReferenceItems,
    promptReferenceCategory,
    promptReferenceSearch,
  );
  const configuredModels = IMAGE_GENERATION_MODELS.filter((model) =>
    formState.apiProviders.some((provider) => provider.supportedModels.includes(model)),
  );
  const promptPolishConfig = resolveApiConfigForPreferredModels(formState, PROMPT_POLISH_MODELS);
  const imageToPromptConfig = resolveApiConfigForPreferredModels(formState, IMAGE_TO_PROMPT_MODELS);
  const generateConfig = resolveApiConfigForModel(formState, formState.model);
  const hasPromptPolishCredentials = Boolean(promptPolishConfig.baseUrl && promptPolishConfig.apiKey);
  const hasImageToPromptCredentials = Boolean(imageToPromptConfig.baseUrl && imageToPromptConfig.apiKey);

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <img className="brand-logo" src="/branding/magic-canvas-logo.png" alt="魔法画布 Logo" />
          <div className="brand-text">
            <strong>魔法画布</strong>
            <span>Magic Canvas</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={activePage === item.id ? 'sidebar-link is-active' : 'sidebar-link'}
              type="button"
              onClick={() => setActivePage(item.id)}
            >
              <span className="sidebar-link-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.title[language]}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-promo">
          <strong>释放你的想象力</strong>
          <p>Ai 让创作更简单</p>
        </div>

        <footer className="sidebar-footer">
          <p>© 2026 Magic Canvas</p>
          <span>v{__APP_VERSION__}</span>
        </footer>
      </aside>

      <div className="dashboard-main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{activeNav.title[language]}</h1>
            <p>{activeNav.description[language]}</p>
          </div>

          <div className="topbar-actions">
            <button className="lang-switch" type="button" onClick={toggleLanguage}>
              <span className={language === 'zh' ? 'is-active' : ''}>中文</span>
              <span className={language === 'en' ? 'is-active' : ''}>EN</span>
            </button>
            <button className="icon-button" type="button" onClick={toggleTheme} aria-label="切换主题">
              {theme === 'light' ? '☾' : '☀'}
            </button>
            <button className="user-chip" type="button">
              <span className="user-avatar">🧙</span>
              <span>Magic User</span>
            </button>
          </div>
        </header>

        <main className="dashboard-content">
          {activePage === 'ai-image' ? (
            <div className="ai-workspace">
              <ConfigForm
                formState={formState}
                uploadState={uploadState}
                isSubmitting={isSubmitting}
                isPolishingPrompt={isPolishingPrompt}
                error={error}
                polishError={polishError}
                polishedPromptDraft={polishedPromptDraft}
                advancedOpen={advancedOpen}
                configuredModels={configuredModels}
                canUsePromptPolish={hasPromptPolishCredentials}
                onSubmit={handleSubmit}
                onFieldChange={updateField}
                onRemoveImage={handleRemoveImage}
                onImageSelect={handleImageSelect}
                onClearImages={clearUploadState}
                onAdvancedToggle={() => setAdvancedOpen((current) => !current)}
                onPolishPrompt={() => {
                  void handlePolishPrompt();
                }}
                onApplyPolishedPrompt={handleApplyPolishedPrompt}
                onDismissPolishedPrompt={handleDismissPolishedPrompt}
                onResetCreativeFields={resetCreativeFields}
              />

              <div className="result-column">
                <ResultPanel
                  image={currentImage}
                  images={currentBatch}
                  isSubmitting={isSubmitting}
                  isFavorite={Boolean(currentImage && favoriteHistoryIds.includes(currentImage.id))}
                  copyFeedback={copyFeedback}
                  history={history}
                  favoriteIds={favoriteHistoryIds}
                  onPreview={(image) => setPreviewImage(image)}
                  onRegenerate={handleRegenerate}
                  onCopy={() => {
                    void handleCopyCurrentImage();
                  }}
                  onEditImage={(image) => {
                    void handleReuseImageForEdit(image);
                  }}
                  onRegionEditImage={(image) => {
                    void handleOpenRegionEditor(image);
                  }}
                  onToggleFavorite={handleToggleFavorite}
                  onSelectHistory={handleSelectHistory}
                  onEditHistoryImage={(image) => {
                    void handleReuseImageForEdit(image);
                  }}
                  onRegionEditHistoryImage={(image) => {
                    void handleOpenRegionEditor(image);
                  }}
                  onClearHistory={handleClearHistory}
                />
              </div>
            </div>
          ) : null}

          {activePage === 'region-editor' ? (
            <Suspense fallback={<div className="empty-state">正在加载局部编辑器...</div>}>
              <ImageEditorPage
                source={editorSource}
                configuredModels={configuredModels}
                initialModel={formState.model}
                initialQuality={formState.quality}
                onSourceChange={setEditorSource}
                onGenerate={handleRegionEditorGenerate}
                onSaveResult={handleSaveEditorResult}
              />
            </Suspense>
          ) : null}

          {activePage === 'image-to-prompt' ? (
            <ImageToPromptPage
              uploadState={imageToPromptUploadState}
              isGenerating={isGeneratingPromptFromImage}
              hasCredentials={hasImageToPromptCredentials}
              targetModel={formState.model}
              generatedPromptDraft={generatedPromptFromImageDraft}
              error={imageToPromptError}
              onImageSelect={handleImageToPromptImageSelect}
              onClearImage={clearImageToPromptUploadState}
              onGenerate={() => {
                void handleGeneratePromptFromImage();
              }}
              onApplyPrompt={handleApplyGeneratedPromptFromImage}
              onDismissPrompt={handleDismissGeneratedPromptFromImage}
            />
          ) : null}

          {activePage === 'prompt-plaza' ? (
            <PromptReference
              items={filteredPromptReferenceItems}
              categories={promptReferenceCategories}
              selectedCategory={promptReferenceCategory}
              searchQuery={promptReferenceSearch}
              sourceLabel={promptReferenceSourceLabel}
              isLoading={promptReferenceLoading}
              error={promptReferenceError}
              onSearchChange={setPromptReferenceSearch}
              onCategoryChange={setPromptReferenceCategory}
              onApply={handleApplyPrompt}
            />
          ) : null}

          {activePage === 'settings' ? (
            <SettingsPanel
              formState={formState}
              showApiKey={showApiKey}
              usageState={usageState}
              uploadState={uploadState}
              error={error}
              onFieldChange={updateField}
              onToggleApiKey={() => setShowApiKey((current) => !current)}
              onClearApiKey={clearActiveApiKey}
              onClearConfig={handleClearConfig}
              onRefreshUsage={() => {
                void refreshUsage();
              }}
            />
          ) : null}
        </main>
      </div>

      <ImagePreviewModal
        image={previewImage}
        open={previewImage !== null}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
}

export default App;
