import sharp from 'sharp';

export async function validateRegionEditInputs(sourceBuffer, maskBuffer, width, height) {
  if (!sourceBuffer || !maskBuffer) {
    return '局部编辑需要同时提供原图和遮罩。';
  }

  try {
    const [sourceMetadata, maskMetadata] = await Promise.all([
      sharp(sourceBuffer).metadata(),
      sharp(maskBuffer).metadata(),
    ]);
    if (sourceMetadata.format !== 'png' || maskMetadata.format !== 'png') {
      return '局部编辑的原图和遮罩必须使用 PNG 格式。';
    }
    if (
      sourceMetadata.width !== width ||
      sourceMetadata.height !== height ||
      maskMetadata.width !== width ||
      maskMetadata.height !== height
    ) {
      return '局部编辑的原图、遮罩与目标画布尺寸必须完全一致。';
    }
    if (!sourceMetadata.hasAlpha || !maskMetadata.hasAlpha) {
      return '局部编辑的原图和遮罩必须包含 Alpha 通道。';
    }

    const { data, info } = await sharp(maskBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let hasSelection = false;
    for (let index = 3; index < data.length; index += info.channels) {
      if (data[index] > 0) {
        hasSelection = true;
        break;
      }
    }
    return hasSelection ? null : '请先在图片上涂抹需要修改的区域。';
  } catch {
    return '无法读取局部编辑的原图或遮罩。';
  }
}

export async function createGptImageMask(maskBuffer) {
  const { data, info } = await sharp(maskBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 4, 255);
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const sourceAlpha = data[pixel * info.channels + 3];
    output[pixel * 4 + 3] = 255 - sourceAlpha;
  }
  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();
}

export async function createGeminiVisibleMask(maskBuffer) {
  const { data, info } = await sharp(maskBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 3);
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const alpha = data[pixel * info.channels + 3];
    output[pixel * 3] = alpha;
    output[pixel * 3 + 1] = alpha;
    output[pixel * 3 + 2] = alpha;
  }
  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: 3 },
  }).png().toBuffer();
}

export function buildGeminiRegionEditPrompt(prompt) {
  return [
    prompt.trim(),
    'REGION EDITING INSTRUCTIONS:',
    'The first image is the source canvas. The second image is a selection map.',
    'Only change pixels corresponding to white or light areas in the selection map. Preserve the subject, layout, lighting, colors, and details everywhere else.',
    'Fill transparent selected areas naturally when extending the canvas. Return one complete edited image without showing the selection map.',
  ].join('\n\n');
}

export async function compositeRegionEdit(sourceBuffer, generatedBase64, maskBuffer, width, height) {
  const [source, generated, mask] = await Promise.all([
    sharp(sourceBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(Buffer.from(generatedBase64, 'base64'))
      .resize(width, height, { fit: 'cover', position: 'centre' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(maskBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  const generatedWithMask = Buffer.from(generated.data);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const generatedAlphaIndex = pixel * generated.info.channels + 3;
    const selectionAlpha = mask.data[pixel * mask.info.channels + 3];
    generatedWithMask[generatedAlphaIndex] = Math.round(
      generatedWithMask[generatedAlphaIndex] * selectionAlpha / 255,
    );
  }

  const maskedGenerated = await sharp(generatedWithMask, {
    raw: { width, height, channels: generated.info.channels },
  }).png().toBuffer();

  return sharp(source.data, {
    raw: { width, height, channels: source.info.channels },
  }).composite([{ input: maskedGenerated, blend: 'over' }]).png().toBuffer();
}
