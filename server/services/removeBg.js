const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Replicate = require('replicate');
const config = require('../config');

const DEFAULT_PADDING = 0.08;

function clamp01(n) {
  return Math.min(1, Math.max(0, Number(n) || 0));
}

/**
 * Crop image by normalized bbox {x,y,w,h} with padding, return PNG buffer.
 */
async function cropByBbox(imagePath, bbox, padding = DEFAULT_PADDING) {
  const meta = await sharp(imagePath).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) throw new Error('Не удалось прочитать размеры изображения');

  const pad = Number.isFinite(padding) ? padding : DEFAULT_PADDING;
  const x = clamp01(bbox.x);
  const y = clamp01(bbox.y);
  const w = clamp01(bbox.w);
  const h = clamp01(bbox.h);

  let left = Math.floor((x - pad) * width);
  let top = Math.floor((y - pad) * height);
  let right = Math.ceil((x + w + pad) * width);
  let bottom = Math.ceil((y + h + pad) * height);

  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(width, right);
  bottom = Math.min(height, bottom);

  const cropW = Math.max(1, right - left);
  const cropH = Math.max(1, bottom - top);

  const buffer = await sharp(imagePath)
    .extract({ left, top, width: cropW, height: cropH })
    .png()
    .toBuffer();

  return {
    buffer,
    crop: { left, top, width: cropW, height: cropH },
    imageSize: { width, height },
  };
}

/**
 * Community models often need owner/name:version; plain owner/name can 404.
 */
async function resolveModelRef(replicate, model) {
  if (!model) return model;
  if (model.includes(':')) return model;
  const [owner, name] = model.split('/');
  if (!owner || !name) return model;
  const info = await replicate.models.get(owner, name);
  const version = info && info.latest_version && info.latest_version.id;
  if (!version) {
    throw new Error(`У модели ${model} нет latest_version`);
  }
  return `${owner}/${name}:${version}`;
}

async function bufferFromReplicateOutput(output) {
  // SDK may return URL string, array of URLs, or FileOutput-like with url()/arrayBuffer()
  let value = output;
  if (Array.isArray(value)) value = value[0];

  if (value && typeof value.arrayBuffer === 'function') {
    return Buffer.from(await value.arrayBuffer());
  }
  if (value && typeof value.url === 'function') {
    const res = await fetch(value.url());
    if (!res.ok) throw new Error(`Не удалось скачать cutout: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (typeof value === 'string') {
    const res = await fetch(value);
    if (!res.ok) throw new Error(`Не удалось скачать cutout: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('Неожиданный ответ Replicate remove-bg');
}

/**
 * Crop by bbox → Replicate remove-bg → save PNG with alpha.
 * Returns { filename, absPath, model, crop } or null if skipped.
 */
async function removeBackgroundFromLook({
  imagePath,
  bbox,
  lookId,
  padding = DEFAULT_PADDING,
}) {
  if (!config.replicateApiToken) {
    console.warn('removeBg: REPLICATE_API_TOKEN не задан — пропуск');
    return null;
  }
  if (!bbox || typeof bbox !== 'object') {
    console.warn('removeBg: нет bbox — пропуск');
    return null;
  }

  const { buffer: cropBuffer, crop, imageSize } = await cropByBbox(
    imagePath,
    bbox,
    padding
  );

  const replicate = new Replicate({ auth: config.replicateApiToken });
  const configured = config.replicateRemoveBgModel || 'lucataco/remove-bg';
  const model = await resolveModelRef(replicate, configured);

  const output = await replicate.run(model, {
    input: {
      image: cropBuffer,
    },
  });

  const png = await bufferFromReplicateOutput(output);
  const filename = `${lookId}-cutout.png`;
  const absPath = path.join(config.uploadDir, filename);
  fs.writeFileSync(absPath, png);

  return {
    filename,
    absPath,
    model,
    crop,
    imageSize,
    bytes: png.length,
  };
}

module.exports = {
  cropByBbox,
  removeBackgroundFromLook,
  DEFAULT_PADDING,
};
