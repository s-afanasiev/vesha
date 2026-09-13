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

function isYoutubeUrl(rawUrl) {
  try {
    const host = new URL(String(rawUrl || '')).hostname.toLowerCase();
    return (
      host === 'youtu.be' ||
      host.endsWith('.youtu.be') ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtube-nocookie.com' ||
      host.endsWith('.youtube-nocookie.com')
    );
  } catch {
    return false;
  }
}

function genericFormat(downloadMode) {
  return normalizeDownloadMode(downloadMode) === 'audio'
    ? 'bestaudio'
    : 'bestvideo+bestaudio/best';
}

function downloadStrategyPlan({ url, downloadMode, videoQuality } = {}) {
  const mode = normalizeDownloadMode(downloadMode);
  const quality = normalizeVideoQuality(videoQuality);
  const generic = genericFormat(mode);
  const merge = mode === 'video' ? ' --merge-output-format mp4' : '';
  const configured = [
    'yt-dlp --js-runtimes node --force-ipv4 --ffmpeg-location ffmpeg',
    `-f "${formatSelector(mode, quality)}"${merge}`,
    '"URL_страницы_с_видео"',
  ].join(' ');
  const minimal = `yt-dlp "URL_страницы_с_видео" -f "${generic}"`;
  const youtubeCookies =
    `yt-dlp --js-runtimes node --cookies-from-browser firefox ` +
    `-f "${generic}" "URL_страницы_с_видео"`;

  const first = {
    id: 'configured',
    title: 'Основной способ',
    description: 'Выбранное качество, совместимый формат и служебные параметры.',
    command: configured,
    status: 'pending',
  };
  const fallback = isYoutubeUrl(url)
    ? {
        id: 'youtube-cookies',
        title: 'YouTube через Firefox cookies',
        description: 'Если YouTube отклонит обычный запрос, повторим с cookies браузера.',
        command: youtubeCookies,
        status: 'pending',
      }
    : {
        id: 'minimal',
        title: 'Максимально простой способ',
        description: 'Без дополнительных параметров: только URL и формат.',
        command: minimal,
        status: 'pending',
      };

  return [first, fallback];
}

module.exports = {
  normalizeDownloadMode,
  normalizeVideoQuality,
  formatSelector,
  outputTemplate,
  qualityLabel,
  expectedStreamCount,
  isYoutubeUrl,
  genericFormat,
  downloadStrategyPlan,
};
