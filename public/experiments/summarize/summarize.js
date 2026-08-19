const toolsEl = document.getElementById('tools');
const form = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const extractBtn = document.getElementById('extract-btn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const titleEl = document.getElementById('result-title');
const metaEl = document.getElementById('result-meta');
const player = document.getElementById('player');

function show(el, text) {
  el.hidden = !text;
  el.textContent = text || '';
}

function formatDuration(sec) {
  if (!Number.isFinite(sec)) return 'длительность неизвестна';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function formatBytes(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

async function loadTools() {
  try {
    const res = await fetch('/api/summarize/tools');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'tools');
    if (data.ready) {
      toolsEl.textContent =
        `yt-dlp ${data.ytdlp.version || ''} · ffmpeg готов`;
    } else {
      toolsEl.textContent =
        'Бинарники не найдены. В корне проекта: npm run media-bins';
    }
  } catch {
    toolsEl.textContent = 'Не удалось проверить yt-dlp/ffmpeg';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  show(errorEl, '');
  resultEl.hidden = true;
  extractBtn.disabled = true;
  show(statusEl, 'Скачиваю звук… это может занять минуту.');
  try {
    const res = await fetch('/api/summarize/from-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlInput.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
    titleEl.textContent = data.title || 'Без названия';
    const bits = [
      data.extractor,
      formatDuration(data.duration),
      formatBytes(data.bytes),
    ].filter(Boolean);
    metaEl.textContent = bits.join(' · ');
    player.src = data.audioUrl;
    resultEl.hidden = false;
    show(statusEl, 'Готово.');
  } catch (err) {
    show(statusEl, '');
    show(errorEl, err.message || 'Не удалось вытянуть звук');
  } finally {
    extractBtn.disabled = false;
  }
});

loadTools();
