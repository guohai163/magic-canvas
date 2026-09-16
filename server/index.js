import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildGenerationPrompt,
  resizeGeneratedImages,
  resolveGeminiOutputConfig,
} from './image-generation.js';
import {
  buildGeminiRegionEditPrompt,
  compositeRegionEdit,
  createGeminiVisibleMask,
  createGptImageMask,
  validateRegionEditInputs,
} from './region-edit.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');
const indexFile = path.join(distDir, 'index.html');
const IMAGE_PATH = '/v1/images/generations';
const EDIT_PATH = '/v1/images/edits';
const GEMINI_IMAGE_PATH = '/v1beta/interactions';
const GEMINI_GENERATE_CONTENT_PATH_PREFIX = '/v1beta/models/';
const GEMINI_GENERATE_CONTENT_PATH_SUFFIX = ':generateContent';
const GEMINI_NATIVE_FALLBACK_STATUSES = new Set([404, 405]);
const RESPONSES_PATH = '/v1/responses';
const USAGE_PATH = '/v1/usage';
const PROMPT_REFERENCE_URL = 'https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main/README.zh-CN.md';
const PROMPT_REFERENCE_SOURCE_URL = 'https://github.com/ZeroLu/awesome-gpt-image';
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_COUNT = 4;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MAX_RATIO = 3;
const IMAGE_MAX_LONG_EDGE = 3840;
const IMAGE_MIN_SHORT_EDGE = 256;
const IMAGE_MIN_PIXELS = 655_360;
const IMAGE_MAX_PIXELS = 8_294_400;
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const SUPPORTED_MODELS = new Set([
  'gemini-3.1-flash-image',
  'gpt-image-2',
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
]);
const IMAGE_GENERATION_MODELS = new Set([
  'gemini-3.1-flash-image',
  'gpt-image-2',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
  },
});

app.use(express.json({ limit: '2mb' }));

app.post('/api/generate', upload.array('image', MAX_REFERENCE_IMAGE_COUNT), async (req, res) => {
  const {
    baseUrl,
    apiKey,
    model,
    prompt,
    negativePrompt = '',
    sizeMode = 'preset',
    size,
    aspectRatio,
    imageSize,
    quality,
  } = req.body ?? {};
  const mode = req.body?.mode ?? 'text';
  const uploadedImages = req.files ?? [];

  const validationError =
    validateBaseFields(baseUrl, apiKey) ||
    validateGenerateFields(model, prompt, negativePrompt, sizeMode, size, aspectRatio, imageSize, quality, mode, uploadedImages);

  if (validationError) {
    res.status(400).json({
      error: {
        message: validationError,
      },
    });
    return;
  }

  const generationPrompt = buildGenerationPrompt(prompt, negativePrompt);
  const geminiOutputConfig = resolveGeminiOutputConfig({
    sizeMode,
    size,
    aspectRatio,
    imageSize,
  });

  const upstreamPath = model === 'gemini-3.1-flash-image'
    ? getGeminiPrimaryPath(baseUrl, model)
    : mode === 'text'
      ? IMAGE_PATH
      : EDIT_PATH;
  const upstreamUrl = buildUpstreamUrl(baseUrl, upstreamPath);
  if (!upstreamUrl) {
    res.status(400).json({
      error: {
        message: '接口域名无效，只允许 http 或 https 协议。',
      },
    });
    return;
  }

  try {
    if (model === 'gemini-3.1-flash-image') {
      const upstreamResponse = await fetchGeminiImage({
        upstreamUrl,
        apiKey,
        model,
        prompt: generationPrompt,
        aspectRatio: geminiOutputConfig.aspectRatio,
        imageSize: geminiOutputConfig.imageSize,
        uploadedImages,
        requestFormat: isGoogleGeminiBaseUrl(baseUrl) ? 'interactions' : 'generateContent',
      });

      if (
        shouldFallbackGeminiNativeRequest(upstreamResponse, baseUrl) &&
        mode === 'text'
      ) {
        const fallbackUrl = buildUpstreamUrl(baseUrl, getGeminiGenerateContentPath(model));
        if (!fallbackUrl) {
          res.status(400).json({
            error: {
              message: '接口域名无效，只允许 http 或 https 协议。',
            },
          });
          return;
        }

        const fallbackResponse = await fetchGeminiImage({
          upstreamUrl: fallbackUrl,
          apiKey,
          model,
          prompt: generationPrompt,
          aspectRatio: geminiOutputConfig.aspectRatio,
          imageSize: geminiOutputConfig.imageSize,
          uploadedImages,
          requestFormat: 'generateContent',
        });

        await proxyGeminiImageResponse(fallbackResponse, res, geminiOutputConfig.targetSize);
        return;
      }

      await proxyGeminiImageResponse(upstreamResponse, res, geminiOutputConfig.targetSize);
      return;
    }

    const upstreamResponse = mode === 'text'
      ? await fetchOpenAiCompatibleImageGeneration({
          upstreamUrl,
          apiKey,
          model,
          prompt: generationPrompt,
          size,
          quality,
        })
      : await fetchWithImageEdit({
          upstreamUrl,
          apiKey,
          model,
          prompt: generationPrompt,
          size,
          quality,
          uploadedImages,
        });

    await proxyResponse(upstreamResponse, res);
  } catch (error) {
    res.status(502).json({
      error: {
        message: '代理请求上游图片接口失败。',
        details: error instanceof Error ? error.message : undefined,
      },
    });
  }
});

app.post('/api/edit-region', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 },
]), async (req, res) => {
  const { baseUrl, apiKey, model, prompt, negativePrompt = '', quality } = req.body ?? {};
  const width = Number(req.body?.width);
  const height = Number(req.body?.height);
  const files = req.files ?? {};
  const sourceImage = Array.isArray(files.image) ? files.image[0] : undefined;
  const selectionMask = Array.isArray(files.mask) ? files.mask[0] : undefined;
  const validationError =
    validateBaseFields(baseUrl, apiKey) ||
    validateImageGenerationModelField(model) ||
    (typeof prompt !== 'string' || !prompt.trim() ? '请描述选区需要如何修改。' : null) ||
    (typeof negativePrompt !== 'string' ? '负面提示词格式无效。' : null) ||
    (!['low', 'medium', 'high', 'auto'].includes(quality) ? '图片品质无效。' : null) ||
    validateImageSize(`${width}x${height}`) ||
    await validateRegionEditInputs(sourceImage?.buffer, selectionMask?.buffer, width, height);

  if (validationError) {
    res.status(400).json({ error: { message: validationError } });
    return;
  }

  const generationPrompt = buildGenerationPrompt(prompt, negativePrompt);
  const geminiOutputConfig = resolveGeminiOutputConfig({
    sizeMode: 'custom',
    size: `${width}x${height}`,
    aspectRatio: '1:1',
    imageSize: '1K',
  });

  try {
    let upstreamResponse;
    if (model === 'gemini-3.1-flash-image') {
      const visibleMask = await createGeminiVisibleMask(selectionMask.buffer);
      const geminiImages = [
        sourceImage,
        {
          ...selectionMask,
          buffer: visibleMask,
          mimetype: 'image/png',
          originalname: 'selection-map.png',
        },
      ];
      const requestFormat = isGoogleGeminiBaseUrl(baseUrl) ? 'interactions' : 'generateContent';
      const upstreamUrl = buildUpstreamUrl(baseUrl, getGeminiPrimaryPath(baseUrl, model));
      upstreamResponse = await fetchGeminiImage({
        upstreamUrl,
        apiKey,
        model,
        prompt: buildGeminiRegionEditPrompt(generationPrompt),
        aspectRatio: geminiOutputConfig.aspectRatio,
        imageSize: geminiOutputConfig.imageSize,
        uploadedImages: geminiImages,
        requestFormat,
      });
      if (shouldFallbackGeminiNativeRequest(upstreamResponse, baseUrl)) {
        const fallbackUrl = buildUpstreamUrl(baseUrl, getGeminiGenerateContentPath(model));
        upstreamResponse = await fetchGeminiImage({
          upstreamUrl: fallbackUrl,
          apiKey,
          model,
          prompt: buildGeminiRegionEditPrompt(generationPrompt),
          aspectRatio: geminiOutputConfig.aspectRatio,
          imageSize: geminiOutputConfig.imageSize,
          uploadedImages: geminiImages,
          requestFormat: 'generateContent',
        });
      }
    } else {
      const upstreamUrl = buildUpstreamUrl(baseUrl, EDIT_PATH);
      const gptMask = await createGptImageMask(selectionMask.buffer);
      upstreamResponse = await fetchWithMaskedImageEdit({
        upstreamUrl,
        apiKey,
        model,
        prompt: generationPrompt,
        size: `${width}x${height}`,
        quality,
        sourceImage,
        maskBuffer: gptMask,
      });
    }

    const contentType = upstreamResponse.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? await upstreamResponse.json()
      : { error: { message: await upstreamResponse.text() } };
    if (!upstreamResponse.ok) {
      res.status(upstreamResponse.status).json(payload);
      return;
    }

    const generatedImages = model === 'gemini-3.1-flash-image'
      ? extractGeminiImageBase64(payload)
      : Array.isArray(payload.data)
        ? payload.data.map((item) => item?.b64_json).filter((value) => typeof value === 'string')
        : [];
    if (generatedImages.length === 0) {
      res.status(502).json({ error: { message: '局部编辑接口返回成功，但未解析到图片内容。' } });
      return;
    }

    const compositedImages = await Promise.all(generatedImages.map(async (image) => (
      await compositeRegionEdit(sourceImage.buffer, image, selectionMask.buffer, width, height)
    ).toString('base64')));
    res.json({
      data: compositedImages.map((b64Json) => ({ b64_json: b64Json, width, height })),
    });
  } catch (error) {
    res.status(502).json({
      error: {
        message: '代理请求上游局部编辑接口失败。',
        details: error instanceof Error ? error.message : undefined,
      },
    });
  }
});

app.post('/api/usage', async (req, res) => {
  const { baseUrl, apiKey } = req.body ?? {};
  const validationError = validateBaseFields(baseUrl, apiKey);

  if (validationError) {
    res.status(400).json({
      error: {
        message: validationError,
      },
    });
    return;
  }

  const upstreamUrl = buildUpstreamUrl(baseUrl, USAGE_PATH);
  if (!upstreamUrl) {
    res.status(400).json({
      error: {
        message: '接口域名无效，只允许 http 或 https 协议。',
      },
    });
    return;
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    });

    await proxyResponse(upstreamResponse, res);
  } catch (error) {
    res.status(502).json({
      error: {
        message: '代理请求上游用量接口失败。',
        details: error instanceof Error ? error.message : undefined,
      },
    });
  }
});

app.post('/api/prompt-polish', async (req, res) => {
  const { baseUrl, apiKey, model, prompt, stylePreset, generationMode, size, quality } = req.body ?? {};
  const validationError =
    validateBaseFields(baseUrl, apiKey) ||
    validateModelField(model) ||
    validatePromptPolishFields(prompt, stylePreset, generationMode, size, quality);

  if (validationError) {
    res.status(400).json({
      error: {
        message: validationError,
      },
    });
    return;
  }

  const upstreamUrl = buildUpstreamUrl(baseUrl, RESPONSES_PATH);
  if (!upstreamUrl) {
    res.status(400).json({
      error: {
        message: '接口域名无效，只允许 http 或 https 协议。',
      },
    });
    return;
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildPromptPolishRequestBody({
        model,
        prompt,
        stylePreset,
        generationMode,
        size,
        quality,
      })),
    });

    const payload = await upstreamResponse.json();
    if (!upstreamResponse.ok) {
      res.status(upstreamResponse.status).json(payload);
      return;
    }

    const polishedPrompt = extractResponseText(payload);
    if (!polishedPrompt) {
      res.status(502).json({
        error: {
          message: '润色接口返回成功，但未解析到有效提示词。',
        },
      });
      return;
    }

    res.json({
      polishedPrompt,
    });
  } catch (error) {
    res.status(502).json({
      error: {
        message: '代理请求上游提示词润色接口失败。',
        details: error instanceof Error ? error.message : undefined,
      },
    });
  }
});

app.post('/api/image-to-prompt', upload.single('image'), async (req, res) => {
  const { baseUrl, apiKey, model, targetModel } = req.body ?? {};
  const uploadedImage = req.file;
  const validationError =
    validateBaseFields(baseUrl, apiKey) ||
    validateModelField(model) ||
    validateModelField(targetModel) ||
    validateImageToPromptFields(uploadedImage);

  if (validationError) {
    res.status(400).json({
      error: {
        message: validationError,
      },
    });
    return;
  }

  const upstreamUrl = buildUpstreamUrl(baseUrl, RESPONSES_PATH);
  if (!upstreamUrl) {
    res.status(400).json({
      error: {
        message: '接口域名无效，只允许 http 或 https 协议。',
      },
    });
    return;
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildImageToPromptRequestBody(uploadedImage, model, targetModel)),
    });

    const payload = await upstreamResponse.json();
    if (!upstreamResponse.ok) {
      res.status(upstreamResponse.status).json(payload);
      return;
    }

    const prompt = extractResponseText(payload);
    if (!prompt) {
      res.status(502).json({
        error: {
          message: '图转提示词接口返回成功，但未解析到有效提示词。',
        },
      });
      return;
    }

    res.json({
      prompt,
    });
  } catch (error) {
    res.status(502).json({
      error: {
        message: '代理请求上游图转提示词接口失败。',
        details: error instanceof Error ? error.message : undefined,
      },
    });
  }
});

app.get('/api/prompt-reference', async (_req, res) => {
  try {
    const upstreamResponse = await fetch(PROMPT_REFERENCE_URL);

    if (!upstreamResponse.ok) {
      res.status(502).json({
        error: {
          message: '拉取提示词参考数据失败。',
          details: `上游返回 HTTP ${upstreamResponse.status}`,
        },
      });
      return;
    }

    const markdown = await upstreamResponse.text();
    const items = parsePromptReferenceMarkdown(markdown);

    res.json({
      items,
      sourceLabel: 'ZeroLu/awesome-gpt-image',
      sourceUrl: PROMPT_REFERENCE_SOURCE_URL,
    });
  } catch (error) {
    res.status(502).json({
      error: {
        message: '加载提示词参考失败。',
        details: error instanceof Error ? error.message : undefined,
      },
    });
  }
});

app.use(express.static(distDir));

app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(indexFile);
});

app.listen(PORT, () => {
  console.log(`Image Gen server listening on http://0.0.0.0:${PORT}`);
});

function normalizeBaseUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

function buildUpstreamUrl(baseUrl, pathName) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return `${url.origin}${pathName}`;
  } catch {
    return null;
  }
}

function getGeminiPrimaryPath(baseUrl, model) {
  return isGoogleGeminiBaseUrl(baseUrl)
    ? GEMINI_IMAGE_PATH
    : getGeminiGenerateContentPath(model);
}

function getGeminiGenerateContentPath(model) {
  return `${GEMINI_GENERATE_CONTENT_PATH_PREFIX}${encodeURIComponent(model)}${GEMINI_GENERATE_CONTENT_PATH_SUFFIX}`;
}

function shouldFallbackGeminiNativeRequest(upstreamResponse, baseUrl) {
  return (
    GEMINI_NATIVE_FALLBACK_STATUSES.has(upstreamResponse.status) &&
    !isGoogleGeminiBaseUrl(baseUrl)
  );
}

function isGoogleGeminiBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return false;
  }

  try {
    const { hostname } = new URL(normalized);
    return hostname === 'generativelanguage.googleapis.com';
  } catch {
    return false;
  }
}

function validateBaseFields(baseUrl, apiKey) {
  if (!normalizeBaseUrl(baseUrl)) {
    return '请输入带中转站的接口域名。';
  }

  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return '请先填写 API Key。';
  }

  return null;
}

function validateGenerateFields(model, prompt, negativePrompt, sizeMode, size, aspectRatio, imageSize, quality, mode, uploadedImages) {
  const modelValidationError = validateImageGenerationModelField(model);
  if (modelValidationError) {
    return modelValidationError;
  }

  if (typeof prompt !== 'string' || !prompt.trim()) {
    return '请填写提示词后再生成图片。';
  }

  if (typeof negativePrompt !== 'string') {
    return '负面提示词格式无效。';
  }

  if (!['preset', 'custom'].includes(sizeMode)) {
    return '图片尺寸模式无效。';
  }

  const acceptedQualities = new Set(['low', 'medium', 'high', 'auto']);
  if (!acceptedQualities.has(quality)) {
    return '图片品质无效，请选择 low、medium、high 或 auto。';
  }

  const acceptedAspectRatios = new Set(['1:1', '3:2', '2:3', '16:9', '9:16']);
  if (!acceptedAspectRatios.has(aspectRatio)) {
    return '图片比例无效，请选择 1:1、3:2、2:3、16:9 或 9:16。';
  }

  const acceptedImageSizes = new Set(['1K', '2K', '4K']);
  if (!acceptedImageSizes.has(imageSize)) {
    return '生成尺寸无效，请选择 1K、2K 或 4K。';
  }

  if (typeof size !== 'string' || !size.trim()) {
    return '图片尺寸无效，请填写合法的 WIDTHxHEIGHT。';
  }

  const sizeValidationError = validateImageSize(size);
  if (sizeValidationError) {
    return sizeValidationError;
  }

  const acceptedModes = new Set(['text', 'reference', 'edit']);
  if (!acceptedModes.has(mode)) {
    return '生成模式无效。';
  }

  if (mode === 'text' && uploadedImages.length > 0) {
    return '纯文本生成模式不需要上传图片。';
  }

  if (mode === 'edit' && uploadedImages.length > 1) {
    return '编辑原图模式仅支持上传 1 张图片。';
  }

  if (mode === 'reference' && uploadedImages.length > MAX_REFERENCE_IMAGE_COUNT) {
    return `参考图生成最多支持上传 ${MAX_REFERENCE_IMAGE_COUNT} 张图片。`;
  }

  for (const uploadedImage of uploadedImages) {
    if (!ACCEPTED_IMAGE_TYPES.has(uploadedImage.mimetype)) {
      return '仅支持 PNG、JPEG、WEBP 或 GIF 图片文件。';
    }
  }

  return null;
}

function validateModelField(model) {
  if (typeof model !== 'string' || !SUPPORTED_MODELS.has(model)) {
    return `模型无效，请选择：${Array.from(SUPPORTED_MODELS).join('、')}。`;
  }

  return null;
}

function validateImageGenerationModelField(model) {
  if (typeof model !== 'string' || !IMAGE_GENERATION_MODELS.has(model)) {
    return `生图模型无效，请选择：${Array.from(IMAGE_GENERATION_MODELS).join('、')}。`;
  }

  return null;
}

function validatePromptPolishFields(prompt, stylePreset, generationMode, size, quality) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return '请先填写提示词后再使用 AI 辅助。';
  }

  if (typeof stylePreset !== 'string' || !stylePreset.trim()) {
    return '风格预设无效。';
  }

  if (typeof generationMode !== 'string' || !generationMode.trim()) {
    return '生成模式无效。';
  }

  if (typeof size !== 'string' || !size.trim()) {
    return '图片尺寸无效。';
  }

  const acceptedQualities = new Set(['low', 'medium', 'high', 'auto']);
  if (!acceptedQualities.has(quality)) {
    return '图片品质无效。';
  }

  return null;
}

function validateImageToPromptFields(uploadedImage) {
  if (!uploadedImage) {
    return '请先上传 1 张图片。';
  }

  if (!ACCEPTED_IMAGE_TYPES.has(uploadedImage.mimetype)) {
    return '仅支持 PNG、JPEG、WEBP 或 GIF 图片文件。';
  }

  return null;
}

function validateImageSize(size) {
  const match = size.trim().match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return '图片尺寸格式无效，请使用 WIDTHxHEIGHT，例如 1920x1024。';
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return '图片尺寸需要是有效的正整数。';
  }

  if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) {
    return `图片宽高都必须能被 ${IMAGE_SIZE_STEP} 整除。`;
  }

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const totalPixels = width * height;
  const ratio = longEdge / shortEdge;

  if (ratio > IMAGE_MAX_RATIO) {
    return `图片比例需要介于 1:${IMAGE_MAX_RATIO} 到 ${IMAGE_MAX_RATIO}:1 之间。`;
  }

  if (longEdge > IMAGE_MAX_LONG_EDGE) {
    return `图片最长边不能超过 ${IMAGE_MAX_LONG_EDGE}px。`;
  }

  if (shortEdge < IMAGE_MIN_SHORT_EDGE) {
    return `图片最短边不能小于 ${IMAGE_MIN_SHORT_EDGE}px。`;
  }

  if (totalPixels < IMAGE_MIN_PIXELS || totalPixels > IMAGE_MAX_PIXELS) {
    return `图片总像素需介于 ${IMAGE_MIN_PIXELS} 和 ${IMAGE_MAX_PIXELS} 之间。`;
  }

  return null;
}

async function fetchOpenAiCompatibleImageGeneration({
  upstreamUrl,
  apiKey,
  model,
  prompt,
  size,
  quality,
}) {
  return fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: prompt.trim(),
      size,
      quality,
      n: 1,
    }),
  });
}

async function fetchWithImageEdit({
  upstreamUrl,
  apiKey,
  model,
  prompt,
  size,
  quality,
  uploadedImages,
}) {
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt.trim());
  formData.append('size', size);
  formData.append('quality', quality);
  formData.append('n', '1');

  for (const uploadedImage of uploadedImages) {
    formData.append(
      'image[]',
      new Blob([uploadedImage.buffer], { type: uploadedImage.mimetype }),
      uploadedImage.originalname,
    );
  }

  return fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: formData,
  });
}

async function fetchWithMaskedImageEdit({
  upstreamUrl,
  apiKey,
  model,
  prompt,
  size,
  quality,
  sourceImage,
  maskBuffer,
}) {
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt.trim());
  formData.append('size', size);
  formData.append('quality', quality);
  formData.append('n', '1');
  formData.append('image[]', new Blob([sourceImage.buffer], { type: 'image/png' }), 'editor-source.png');
  formData.append('mask', new Blob([maskBuffer], { type: 'image/png' }), 'editor-mask.png');
  return fetch(upstreamUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    body: formData,
  });
}

async function fetchGeminiImage({
  upstreamUrl,
  apiKey,
  model,
  prompt,
  aspectRatio,
  imageSize,
  uploadedImages,
  requestFormat,
}) {
  return fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey.trim(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildGeminiImageRequestBody({
      model,
      prompt,
      aspectRatio,
      imageSize,
      uploadedImages,
      requestFormat,
    })),
  });
}

function buildGeminiImageRequestBody({
  model,
  prompt,
  aspectRatio,
  imageSize,
  uploadedImages,
  requestFormat,
}) {
  if (requestFormat === 'generateContent') {
    return buildGeminiGenerateContentRequestBody({
      prompt,
      aspectRatio,
      imageSize,
      uploadedImages,
    });
  }

  const input = [
    {
      type: 'text',
      text: prompt.trim(),
    },
    ...uploadedImages.map((uploadedImage) => ({
      type: 'image',
      mime_type: uploadedImage.mimetype,
      data: uploadedImage.buffer.toString('base64'),
    })),
  ];

  return {
    model,
    input,
    response_format: {
      type: 'image',
      mime_type: 'image/png',
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    },
  };
}

function buildGeminiGenerateContentRequestBody({
  prompt,
  aspectRatio,
  imageSize,
  uploadedImages,
}) {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: prompt.trim(),
          },
          ...uploadedImages.map((uploadedImage) => ({
            inlineData: {
              mimeType: uploadedImage.mimetype,
              data: uploadedImage.buffer.toString('base64'),
            },
          })),
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio,
        imageSize,
      },
    },
  };
}

async function proxyResponse(upstreamResponse, res) {
  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  res.status(upstreamResponse.status);

  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }

  if (contentType.includes('application/json')) {
    const payload = await upstreamResponse.json();
    res.json(attachImageDimensions(payload));
    return;
  }

  res.send(await upstreamResponse.text());
}

async function proxyGeminiImageResponse(upstreamResponse, res, targetSize = null) {
  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  const payload = isJson
    ? await upstreamResponse.json()
    : { error: { message: await upstreamResponse.text() } };

  if (!upstreamResponse.ok) {
    res.status(upstreamResponse.status).json(payload);
    return;
  }

  if (!isJson) {
    res.status(502).json({
      error: {
        message: 'Gemini 图片接口返回了非 JSON 响应。',
        details: payload.error?.message,
      },
    });
    return;
  }

  const images = await resizeGeneratedImages(extractGeminiImageBase64(payload), targetSize);
  if (images.length === 0) {
    res.status(502).json({
      error: {
        message: 'Gemini 图片接口返回成功，但未解析到图片内容。',
      },
    });
    return;
  }

  res.json(attachImageDimensions({
    data: images.map((b64Json) => ({
      b64_json: b64Json,
    })),
  }));
}

function extractGeminiImageBase64(payload) {
  const images = [];
  collectGeminiImageBase64(payload, images);
  return images;
}

function collectGeminiImageBase64(value, images) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (typeof value.data === 'string' && typeof value.mime_type === 'string' && value.mime_type.startsWith('image/')) {
    images.push(stripDataUrlPrefix(value.data));
  }

  if (typeof value.data === 'string' && typeof value.mimeType === 'string' && value.mimeType.startsWith('image/')) {
    images.push(stripDataUrlPrefix(value.data));
  }

  if (typeof value.image_url === 'string' && value.image_url.startsWith('data:image/')) {
    images.push(stripDataUrlPrefix(value.image_url));
  }

  if (typeof value.b64_json === 'string') {
    images.push(stripDataUrlPrefix(value.b64_json));
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        collectGeminiImageBase64(item, images);
      }
    } else if (child && typeof child === 'object') {
      collectGeminiImageBase64(child, images);
    }
  }
}

function stripDataUrlPrefix(value) {
  return value.replace(/^data:image\/[^;]+;base64,/i, '');
}

function attachImageDimensions(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
    return payload;
  }

  return {
    ...payload,
    data: payload.data.map((item) => {
      if (!item || typeof item !== 'object' || typeof item.b64_json !== 'string') {
        return item;
      }

      const dimensions = getImageDimensionsFromBase64(item.b64_json);
      return dimensions
        ? {
            ...item,
            width: dimensions.width,
            height: dimensions.height,
          }
        : item;
    }),
  };
}

function getImageDimensionsFromBase64(value) {
  try {
    const buffer = Buffer.from(value, 'base64');
    return (
      getPngDimensions(buffer) ||
      getJpegDimensions(buffer) ||
      getGifDimensions(buffer) ||
      getWebpDimensions(buffer) ||
      null
    );
  } catch {
    return null;
  }
}

function getPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function getJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) {
      return null;
    }

    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      };
    }

    offset += 2 + length;
  }

  return null;
}

function getGifDimensions(buffer) {
  if (buffer.length < 10) {
    return null;
  }

  const signature = buffer.toString('ascii', 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    return null;
  }

  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function getWebpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X' && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  if (chunkType === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

function buildPromptPolishRequestBody({
  model,
  prompt,
  stylePreset,
  generationMode,
  size,
  quality,
}) {
  return {
    model,
    input: [
      {
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: [
              '你是一位专业的生图提示词专家。',
              '你的任务是把用户原始提示词润色成更适合图像生成模型使用的高质量提示词。',
              '必须保留用户主体意图，不得擅自改题或改场景方向。',
              '输出只返回最终可直接用于生图的提示词正文。',
              '不要输出解释、标题、列表、前后缀说明、引号或额外备注。',
              '如果原始提示词已经足够完整，只做轻量润色。',
              '不要生成负面提示词。',
              '不要自动加入 --ar、--stylize 等参数风格语法。',
            ].join('\n'),
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              '请根据以下信息润色主提示词，使其更适合图片生成。',
              '',
              `原始提示词：${prompt.trim()}`,
              `风格预设：${describeStylePreset(stylePreset)}`,
              `生成模式：${describeGenerationMode(generationMode)}`,
              `图片比例：${size}`,
              `生成质量：${quality}`,
            ].join('\n'),
          },
        ],
      },
    ],
  };
}

function buildImageToPromptRequestBody(uploadedImage, model, targetModel) {
  return {
    model,
    input: [
      {
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: [
              '你是一位专业的生图提示词专家。',
              `你的任务是观察输入图片，并生成一段适合 ${targetModel} 使用的高质量提示词。`,
              '输出必须是单段、可直接用于图片生成的主提示词正文。',
              '不要输出解释、标题、列表、JSON、分段标签。',
              '不要生成负面提示词。',
              '不要写 --ar、--stylize 等参数化语法。',
              '尽量准确描述主体、构图、材质、光影、色彩、镜头感、背景环境与整体风格。',
            ].join('\n'),
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `请根据这张图，生成一段能让 ${targetModel} 复现相近画面的中文提示词。结果应贴近画面主体、构图、光影、风格与细节。`,
          },
          {
            type: 'input_image',
            image_url: buildImageDataUrl(uploadedImage),
          },
        ],
      },
    ],
  };
}

function buildImageDataUrl(uploadedImage) {
  return `data:${uploadedImage.mimetype};base64,${uploadedImage.buffer.toString('base64')}`;
}

function describeStylePreset(stylePreset) {
  const styleMap = {
    none: '无风格（保持自由创作）',
    realistic: '写实（细节真实、电影感）',
    illustration: '插画（柔和笔触、叙事感）',
    anime: '动漫（高饱和、角色感）',
    'three-d': '3D渲染（体积光、材质细腻）',
    cyberpunk: '赛博朋克（霓虹、未来都市）',
  };

  return styleMap[stylePreset] ?? String(stylePreset);
}

function describeGenerationMode(generationMode) {
  const modeMap = {
    text: '文生图',
    reference: '图生图',
    edit: '图片编辑',
  };

  return modeMap[generationMode] ?? String(generationMode);
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  const parts = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      const text = block?.text;
      if (typeof text === 'string' && text.trim()) {
        parts.push(text.trim());
      }
    }
  }

  return parts.join('\n').trim() || '';
}

function splitBeforeHeading(markdown, prefix) {
  const blocks = [];
  const lines = markdown.split('\n');
  let current = [];

  for (const line of lines) {
    if (line.startsWith(prefix) && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }

  return blocks;
}

function firstMatch(value, pattern) {
  const match = value.match(pattern);
  return match && match[1] ? match[1] : '';
}

function normalizePromptReferenceTitle(title) {
  return title.replace(/\[([^\]]+)]\([^)]+\)/g, '$1').trim();
}

function extractPromptReferenceImages(block) {
  const seen = new Set();
  const images = [];
  const patterns = [/<img[^>]+src="([^"]+)"/g, /!\[[^\]]*\]\(([^)]+)\)/g];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(block)) !== null) {
      const image = match[1]?.trim();
      if (image && !seen.has(image)) {
        seen.add(image);
        images.push(image);
      }
    }
  }

  return images;
}

function tagsFromCategory(category) {
  if (!category) {
    return [];
  }

  return category
    .replace(/[^\p{L}\p{N}/&、与 ]/gu, '')
    .split(/\s*(\/|&|、|与)\s*/u)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function summarizePrompt(content) {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  return singleLine.length > 80 ? `${singleLine.slice(0, 80)}...` : singleLine;
}

function parsePromptReferenceMarkdown(markdown) {
  const items = [];
  const sections = splitBeforeHeading(markdown, '## ');

  for (const section of sections) {
    const category = firstMatch(section, /^##\s+(.+)$/m).trim();
    if (!category) {
      continue;
    }

    const blocks = splitBeforeHeading(section, '### ');
    for (const block of blocks) {
      const rawTitle = firstMatch(block, /^###\s+(.+)$/m);
      const title = normalizePromptReferenceTitle(rawTitle);
      const content = firstMatch(block, /\*\*提示词:\*\*\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/).trim();

      if (!title || !content) {
        continue;
      }

      const id = `zerolu-${items.length}`;
      items.push({
        id,
        title,
        category,
        content,
        images: extractPromptReferenceImages(block),
        tags: tagsFromCategory(category),
        source: 'awesome-gpt-image',
        sourceUrl: PROMPT_REFERENCE_SOURCE_URL,
        summary: summarizePrompt(content),
      });
    }
  }

  return items.map(({ summary, ...item }) => item);
}

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      error: {
        message: '上传图片不能超过 10MB。',
      },
    });
    return;
  }

  if (error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json({
      error: {
        message: '参考图生成最多支持上传 4 张图片。',
      },
    });
    return;
  }

  if (error) {
    res.status(400).json({
      error: {
        message: '上传图片解析失败，请重新选择文件后再试。',
        details: error instanceof Error ? error.message : undefined,
      },
    });
    return;
  }

  next();
});
