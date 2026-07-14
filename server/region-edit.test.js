import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  compositeRegionEdit,
  createGeminiVisibleMask,
  createGptImageMask,
  validateRegionEditInputs,
} from './region-edit.js';

async function createRgbaImage(width, height, color) {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer();
}

async function createHalfMask(width, height) {
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[(y * width + x) * 4 + 3] = x < width / 2 ? 0 : 255;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

test('validateRegionEditInputs accepts matching RGBA PNG files with a selection', async () => {
  const source = await createRgbaImage(16, 16, '#ff0000');
  const mask = await createHalfMask(16, 16);
  assert.equal(await validateRegionEditInputs(source, mask, 16, 16), null);
});

test('validateRegionEditInputs rejects mismatched dimensions and empty masks', async () => {
  const source = await createRgbaImage(16, 16, '#ff0000');
  const wrongMask = await createHalfMask(8, 8);
  assert.match(await validateRegionEditInputs(source, wrongMask, 16, 16), /尺寸必须完全一致/);

  const emptyMask = await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
  }).png().toBuffer();
  assert.match(await validateRegionEditInputs(source, emptyMask, 16, 16), /涂抹需要修改/);
});

test('model masks use inverse alpha for GPT and visible white for Gemini', async () => {
  const mask = await createHalfMask(16, 16);
  const gptMask = await sharp(await createGptImageMask(mask)).ensureAlpha().raw().toBuffer();
  const geminiMask = await sharp(await createGeminiVisibleMask(mask)).raw().toBuffer();

  assert.equal(gptMask[3], 255);
  assert.equal(gptMask[(15 * 4) + 3], 0);
  assert.equal(geminiMask[0], 0);
  assert.equal(geminiMask[15 * 3], 255);
});

test('compositeRegionEdit preserves protected pixels and replaces selected pixels', async () => {
  const source = await createRgbaImage(16, 16, '#ff0000');
  const generated = await createRgbaImage(16, 16, '#0000ff');
  const mask = await createHalfMask(16, 16);
  const result = await compositeRegionEdit(source, generated.toString('base64'), mask, 16, 16);
  const pixels = await sharp(result).ensureAlpha().raw().toBuffer();

  assert.deepEqual(Array.from(pixels.subarray(0, 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(pixels.subarray(15 * 4, 16 * 4)), [0, 0, 255, 255]);
});
