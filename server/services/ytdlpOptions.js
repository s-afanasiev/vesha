const DOWNLOAD_MODES = new Set(['video', 'audio']);
const VIDEO_QUALITIES = new Set(['best', '1080', '720', '480', '360']);

function normalizeDownloadMode(value) {
  const mode = String(value || 'video').toLowerCase();
  return DOWNLOAD_MODES.has(mode) ? mode : 'video';
}

function normalizeVideoQuality(value) {
  const quality = String(value || '720').toLowerCase();
  return VIDEO_QUALITIES.has(quality) ? quality : '720';
}

function heightFilter(quality) {
  return quality === 'best' ? '' : `[height<=${quality}]`;
}

function formatSelector(downloadMode, videoQuality) {
  const mode = normalizeDownloadMode(downloadMode);
  if (mode === 'audio') return 'ba[ext=m4a]/ba';

  const height = heightFilter(normalizeVideoQuality(videoQuality));
  return [
    `bv[ext=mp4][vcodec^=avc1]${height}+ba[ext=m4a]`,
    `b[ext=mp4][vcodec^=avc1]${height}`,
    `b[ext=mp4]${height}`,
  ].join('/');
}

function outputTemplate(downloadMode, token) {
  const prefix = normalizeDownloadMode(downloadMode) === 'audio' ? 'audio' : 'video';
  const safeToken = String(token || 'download')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8) || 'download';
  return `${prefix}-${safeToken}.%(ext)s`;
}

function qualityLabel(value) {
  const quality = normalizeVideoQuality(value);
  return quality === 'best' ? 'лучшее совместимое MP4' : `до ${quality}p`;
}

function expectedStreamCount(downloadMode) {
  return normalizeDownloadMode(downloadMode) === 'audio' ? 1 : 2;
}

module.exports = {
  normalizeDownloadMode,
  normalizeVideoQuality,
  formatSelector,
  outputTemplate,
  qualityLabel,
  expectedStreamCount,
};
