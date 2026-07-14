import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  buildGenerationPrompt,
  resizeGeneratedImages,
  resolveGeminiOutputConfig,
} from './image-generation.js';

test('buildGenerationPrompt keeps the positive prompt unchanged without exclusions', () => {
  assert.equal(buildGenerationPrompt('  a white cat  '), 'a white cat');
});

test('buildGenerationPrompt promotes negative prompts to hard exclusions', () => {
  const prompt = buildGenerationPrompt('a white cat', 'watermark, text');

  assert.match(prompt, /^a white cat/);
  assert.match(prompt, /MANDATORY EXCLUSIONS \(hard constraints\)/);
  assert.match(prompt, /watermark, text/);
});

test('resolveGeminiOutputConfig preserves preset selections', () => {
  assert.deepEqual(resolveGeminiOutputConfig({
    sizeMode: 'preset',
    size: '1536x1024',
    aspectRatio: '3:2',
    imageSize: '1K',
  }), {
    aspectRatio: '3:2',
    imageSize: '1K',
    targetSize: null,
  });
});

test('resolveGeminiOutputConfig derives a suitable Gemini request for a custom size', () => {
  assert.deepEqual(resolveGeminiOutputConfig({
    sizeMode: 'custom',
    size: '1920x1024',
    aspectRatio: '1:1',
    imageSize: '1K',
  }), {
    aspectRatio: '16:9',
    imageSize: '2K',
    targetSize: { width: 1920, height: 1024 },
  });
});

test('resizeGeneratedImages returns the exact requested dimensions', async () => {
  const source = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: '#ff0000',
    },
  }).png().toBuffer();

  const [resizedBase64] = await resizeGeneratedImages(
    [source.toString('base64')],
    { width: 48, height: 32 },
  );
  const metadata = await sharp(Buffer.from(resizedBase64, 'base64')).metadata();

  assert.equal(metadata.width, 48);
  assert.equal(metadata.height, 32);
  assert.equal(metadata.format, 'png');
});
