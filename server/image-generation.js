import sharp from 'sharp';

const GEMINI_ASPECT_RATIOS = [
  ['1:1', 1],
  ['2:3', 2 / 3],
  ['3:2', 3 / 2],
  ['3:4', 3 / 4],
  ['4:3', 4 / 3],
  ['4:5', 4 / 5],
  ['5:4', 5 / 4],
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
];

const GEMINI_SIZE_TIERS = [
  ['1K', 1024 * 1024],
  ['2K', 2048 * 2048],
  ['4K', 4096 * 4096],
];

export function buildGenerationPrompt(prompt, negativePrompt = '') {
  const trimmedPrompt = prompt.trim();
  const exclusions = typeof negativePrompt === 'string' ? negativePrompt.trim() : '';

  if (!exclusions) {
    return trimmedPrompt;
  }

  return [
    trimmedPrompt,
    'MANDATORY EXCLUSIONS (hard constraints):',
    `The generated image must not contain or depict any of the following: ${exclusions}`,
    'Apply these exclusions to objects, visual traits, text, logos, watermarks, and artifacts. Do not ignore or reinterpret them.',
  ].join('\n\n');
}

export function parseImageSize(size) {
  const match = typeof size === 'string' ? size.trim().match(/^(\d+)x(\d+)$/i) : null;
  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

export function resolveGeminiOutputConfig({ sizeMode, size, aspectRatio, imageSize }) {
  if (sizeMode !== 'custom') {
    return {
      aspectRatio,
      imageSize,
      targetSize: null,
    };
  }

  const targetSize = parseImageSize(size);
  if (!targetSize) {
    return {
      aspectRatio,
      imageSize,
      targetSize: null,
    };
  }

  const targetRatio = targetSize.width / targetSize.height;
  const closestAspectRatio = GEMINI_ASPECT_RATIOS.reduce((closest, candidate) => (
    Math.abs(Math.log(candidate[1] / targetRatio)) < Math.abs(Math.log(closest[1] / targetRatio))
      ? candidate
      : closest
  ));
  const targetPixels = targetSize.width * targetSize.height;
  const resolvedImageSize = GEMINI_SIZE_TIERS.find(([, pixels]) => pixels >= targetPixels)?.[0] ?? '4K';

  return {
    aspectRatio: closestAspectRatio[0],
    imageSize: resolvedImageSize,
    targetSize,
  };
}

export async function resizeGeneratedImages(images, targetSize) {
  if (!targetSize) {
    return images;
  }

  return Promise.all(images.map(async (base64Image) => {
    const resizedImage = await sharp(Buffer.from(base64Image, 'base64'))
      .resize(targetSize.width, targetSize.height, {
        fit: 'cover',
        position: 'centre',
      })
      .png()
      .toBuffer();

    return resizedImage.toString('base64');
  }));
}
