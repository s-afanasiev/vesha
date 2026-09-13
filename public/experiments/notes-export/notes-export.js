(function () {
  const MODE_HINTS = {
    off: 'Выкл — только заголовки модулей и уроков, текст дословно.',
    on: 'Вкл — оглавление, модули/уроки и суммаризация тезисов.',
  };

  const sourceText = document.getElementById('source-text');
  const titleInput = document.getElementById('doc-title');
  const formatInputs = Array.from(document.querySelectorAll('input[name="source-format"]'));
  const llmCard = document.getElementById('llm-card');
  const htmlCard = document.getElementById('html-card');
  const summarizeToggle = document.getElementById('summarize-toggle');
  const modeHint = document.getElementById('mode-hint');
  const llmBtn = document.getElementById('llm-btn');
  const htmlBtn = document.getElementById('html-btn');
  const useSourceBtn = document.getElementById('use-source-btn');
  const copyMdBtn = document.getElementById('copy-md-btn');
  const mdEditor = document.getElementById('md-editor');
  const mdHint = document.getElementById('md-hint');
  const htmlExportBtn = document.getElementById('html-export-btn');
  const errorEl = document.getElementById('error');
  const previewCard = document.getElementById('preview-card');
  const previewTitle = document.getElementById('preview-title');
  const previewMeta = document.getElementById('preview-meta');
  const downloadBtn = document.getElementById('download-btn');
  const htmlFrame = document.getElementById('html-frame');
  const llmStatus = document.getElementById('llm-status');
  const converterStatus = document.getElementById('converter-status');
  const llmBusy = document.getElementById('llm-busy');
  const htmlBusy = document.getElementById('html-busy');
  const exportBusy = document.getElementById('export-busy');

  let editorTouched = false;
  let htmlBlobUrl = '';
  let downloadUrl = '';
  let tools = { llmOk: false, llmMock: false };

  function getFormat() {
    const selected = formatInputs.find((el) => el.checked);
    return (selected && selected.value) || 'txt';
  }

  function showError(text) {
    errorEl.hidden = !text;
    errorEl.textContent = text || '';
  }

  function setPill(el, text, kind) {
    el.textContent = text;
    el.classList.toggle('is-ok', kind === 'ok');
    el.classList.toggle('is-bad', kind === 'bad');
  }

  function setBusy(button, busyEl, busy, label) {
    button.disabled = busy;
    const spinner = button.querySelector('.ne-spinner');
    if (spinner) spinner.hidden = !busy;
    if (busyEl) {
      busyEl.hidden = !busy;
      if (label) busyEl.textContent = label;
    }
  }

  function revokeUrls() {
    if (htmlBlobUrl) URL.revokeObjectURL(htmlBlobUrl);
    if (downloadUrl && downloadUrl !== htmlBlobUrl) URL.revokeObjectURL(downloadUrl);
    htmlBlobUrl = '';
    downloadUrl = '';
  }

  function securePreviewHtml(html) {
    const policy =
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
    const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
    return /<head(?:\s[^>]*)?>/i.test(html)
      ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + meta)
      : meta + html;
  }

  function currentMarkdown() {
    const edited = mdEditor.value.trim();
    if (edited) return mdEditor.value;
    if (getFormat() === 'md') return sourceText.value;
    return '';
  }

  function fillEditor(markdown, { touch = true } = {}) {
    mdEditor.value = markdown;
    editorTouched = touch;
    updatePanels();
  }

  function updatePanels() {
    const format = getFormat();
    const summarizeOn = summarizeToggle.checked;
    modeHint.textContent = summarizeOn ? MODE_HINTS.on : MODE_HINTS.off;

    llmCard.hidden = format !== 'txt';
    htmlCard.hidden = format !== 'html';
    llmCard.classList.toggle('is-disabled', format !== 'txt');
    llmBtn.disabled = format !== 'txt' || !tools.llmOk;

    if (format === 'md' && !editorTouched) {
      mdEditor.value = sourceText.value;
    }

    const hasMd = Boolean(currentMarkdown().trim());
    htmlExportBtn.disabled = !hasMd;
    useSourceBtn.disabled = !sourceText.value.trim();

    if (format === 'md') {
      mdHint.textContent = 'Markdown из исходного поля. Можно править перед сборкой.';
    } else if (format === 'html') {
      mdHint.textContent = 'Сначала преобразуйте HTML — затем правьте Markdown и собирайте.';
    } else {
      mdHint.textContent = 'После LLM можно править Markdown руками и сразу собирать HTML.';
    }
  }

  async function readError(res) {
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('application/json')) {
      const data = await res.json().catch(() => ({}));
      return data.error || 'Ошибка запроса';
    }
    const text = await res.text();
    return text.slice(0, 180) || 'Ошибка запроса';
  }

  function syncLlmPill() {
    if (tools.llmMock) {
      tools.llmOk = true;
      setPill(llmStatus, 'LLM: mock-режим', 'ok');
      llmBtn.disabled = getFormat() !== 'txt';
      return;
    }
    if (!window.VeshaLlm) {
      setPill(llmStatus, 'LLM: загрузка…');
      return;
    }
    setPill(
      llmStatus,
      window.VeshaLlm.statusLabel(),
      window.VeshaLlm.isReady() ? 'ok' : 'bad'
    );
    tools.llmOk = window.VeshaLlm.isReady();
    llmBtn.disabled = getFormat() !== 'txt' || !tools.llmOk;
  }

  async function loadStatus() {
    try {
      const res = await fetch('/api/notes-export/status');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'status');

      tools.llmMock = Boolean(data.mock);
      const converters = data.converters || {};
      const ready =
        converters.htmlToMarkdown === 'turndown' &&
        converters.markdownToHtml === 'marked';
      setPill(
        converterStatus,
        ready ? 'Конвертеры: Turndown · Marked' : 'Конвертеры недоступны',
        ready ? 'ok' : 'bad'
      );
    } catch (err) {
      setPill(converterStatus, 'Не удалось проверить конвертеры', 'bad');
    }
    if (window.VeshaLlm && typeof window.VeshaLlm.refreshStatus === 'function') {
      await window.VeshaLlm.refreshStatus();
    }
    syncLlmPill();
    updatePanels();
  }

  async function processLlm() {
    showError('');
    syncLlmPill();
    if (!tools.llmOk) {
      showError('Сначала настройте выбранный LLM-провайдер');
      return;
    }
    const text = sourceText.value.trim();
    if (!text) {
      showError('Вставьте исходный текст');
      return;
    }
    setBusy(llmBtn, llmBusy, true, 'Отправляю текст в модель…');
    htmlExportBtn.disabled = true;
    try {
      const res = await fetch('/api/notes-export/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          mode: summarizeToggle.checked ? 'summarize' : 'structure',
          llm: window.VeshaLlm ? window.VeshaLlm.getPayload() : { provider: 'gemini' },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Не удалось обработать текст');
      fillEditor(data.markdown || '');
      mdEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError(err.message || 'Ошибка LLM');
    } finally {
      setBusy(llmBtn, llmBusy, false);
      updatePanels();
    }
  }

  async function convertHtml() {
    showError('');
    const html = sourceText.value.trim();
    if (!html) {
      showError('Вставьте HTML');
      return;
    }
    setBusy(htmlBtn, htmlBusy, true, 'Turndown конвертирует HTML…');
    try {
      const res = await fetch('/api/notes-export/to-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Не удалось конвертировать HTML');
      fillEditor(data.markdown || '');
      mdEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError(err.message || 'Ошибка конвертации');
    } finally {
      setBusy(htmlBtn, htmlBusy, false);
      updatePanels();
    }
  }

  async function exportHtml() {
    showError('');
    const markdown = currentMarkdown().trim();
    if (!markdown) {
      showError('В редакторе нет Markdown');
      return;
    }
    const title = titleInput.value.trim() || 'Конспект курса';
    setBusy(htmlExportBtn, exportBusy, true, 'Marked собирает standalone HTML…');
    try {
      const res = await fetch('/api/notes-export/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown, format: 'html', title }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const blob = await res.blob();
      const headerName = res.headers.get('X-Notes-Export-Filename');
      const filename = headerName ? decodeURIComponent(headerName) : 'conspect.html';
      revokeUrls();
      downloadUrl = URL.createObjectURL(blob);
      downloadBtn.href = downloadUrl;
      downloadBtn.setAttribute('download', filename);
      previewCard.hidden = false;
      previewMeta.textContent = filename + ' · HTML';
      const previewHtml = securePreviewHtml(await blob.text());
      htmlBlobUrl = URL.createObjectURL(
        new Blob([previewHtml], { type: 'text/html;charset=utf-8' })
      );
      htmlFrame.hidden = false;
      htmlFrame.src = htmlBlobUrl;
      previewTitle.textContent = 'Предпросмотр HTML';
      previewCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError(err.message || 'Ошибка сборки');
    } finally {
      setBusy(htmlExportBtn, exportBusy, false);
      updatePanels();
    }
  }

  formatInputs.forEach((el) => {
    el.addEventListener('change', () => {
      if (getFormat() === 'md') editorTouched = false;
      updatePanels();
    });
  });

  summarizeToggle.addEventListener('change', updatePanels);

  sourceText.addEventListener('input', () => {
    if (getFormat() === 'md' && !editorTouched) mdEditor.value = sourceText.value;
    updatePanels();
  });

  mdEditor.addEventListener('input', () => {
    editorTouched = true;
    updatePanels();
  });

  useSourceBtn.addEventListener('click', () => {
    const format = getFormat();
    if (format === 'html') {
      convertHtml();
      return;
    }
    fillEditor(sourceText.value, { touch: format !== 'md' });
  });

  copyMdBtn.addEventListener('click', async () => {
    const text = mdEditor.value;
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      copyMdBtn.textContent = 'Скопировано';
      setTimeout(() => {
        copyMdBtn.textContent = 'Копировать';
      }, 1400);
    } catch {
      mdEditor.focus();
      mdEditor.select();
      showError('Не удалось скопировать — выделите текст вручную');
    }
  });

  llmBtn.addEventListener('click', processLlm);
  htmlBtn.addEventListener('click', convertHtml);
  htmlExportBtn.addEventListener('click', exportHtml);
  document.addEventListener('llm:change', syncLlmPill);

  window.addEventListener('beforeunload', revokeUrls);

  updatePanels();
  loadStatus();
})();
