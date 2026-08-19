(function () {
  const usageEl = document.getElementById('usage');
  const guestLoginPrompt = document.getElementById('guest-login-prompt');
  const logoutBtn = document.getElementById('logout-btn');

  const uploadForm = document.getElementById('upload-form');
  const dropLabel = document.getElementById('drop-label');
  const imageInput = document.getElementById('image-input');
  const previewWrap = document.getElementById('preview-wrap');
  const preview = document.getElementById('preview');
  const previewClear = document.getElementById('preview-clear');
  const uploadBtn = document.getElementById('upload-btn');
  const statusEl = document.getElementById('status');
  const resultEl = document.getElementById('result');
  const resultMeta = document.getElementById('result-meta');
  const recalcBtn = document.getElementById('recalc-btn');
  const dedupeNote = document.getElementById('dedupe-note');
  const colorsPanel = document.getElementById('colors-panel');
  const colorSwatches = document.getElementById('color-swatches');
  const attrsPanel = document.getElementById('attrs-panel');
  const attrsRoot = document.getElementById('attrs-root');
  const bboxPanel = document.getElementById('bbox-panel');
  const bboxFrame = document.getElementById('bbox-frame');
  const bboxImage = document.getElementById('bbox-image');
  const bboxBox = document.getElementById('bbox-box');
  const bboxMeta = document.getElementById('bbox-meta');
  const bboxHint = document.getElementById('bbox-hint');
  const cutoutPanel = document.getElementById('cutout-panel');
  const cutoutImage = document.getElementById('cutout-image');
  const cutoutHint = document.getElementById('cutout-hint');
  const cutoutMeta = document.getElementById('cutout-meta');
  const offersEl = document.getElementById('offers');
  const historyPanel = document.getElementById('history-panel');
  const historyCarousel = document.getElementById('history-carousel');
  const carouselPrev = document.getElementById('carousel-prev');
  const carouselNext = document.getElementById('carousel-next');
  const colorModal = document.getElementById('color-modal');
  const colorModalSwatch = document.getElementById('color-modal-swatch');
  const colorModalRows = document.getElementById('color-modal-rows');

  let activeLookId = null;

  const UPLOAD_BTN_LABEL = 'Найти где купить';
  const UPLOAD_BTN_BUSY = 'Ищем…';
  const COPY_ICON = './copy-icon.svg';

  function copyBtn(value) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'podborka__copy-btn';
    btn.title = 'Копировать';
    btn.setAttribute('aria-label', 'Копировать');
    const img = document.createElement('img');
    img.src = COPY_ICON;
    img.alt = '';
    btn.appendChild(img);
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(String(value));
        btn.classList.add('is-copied');
        btn.title = 'Скопировано';
        setTimeout(() => {
          btn.classList.remove('is-copied');
          btn.title = 'Копировать';
        }, 1200);
      } catch (_) {
        setStatus('Не удалось скопировать', 'error');
      }
    });
    return btn;
  }

  function formatCellValue(value) {
    if (value == null || value === '') return '—';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') {
      if (
        value.x != null &&
        value.y != null &&
        value.w != null &&
        value.h != null
      ) {
        return (
          'x=' +
          Number(value.x).toFixed(3) +
          ', y=' +
          Number(value.y).toFixed(3) +
          ', w=' +
          Number(value.w).toFixed(3) +
          ', h=' +
          Number(value.h).toFixed(3)
        );
      }
      return JSON.stringify(value);
    }
    return String(value);
  }

  function renderBboxPreview(lookId, bbox) {
    if (!lookId) {
      bboxPanel.hidden = true;
      return;
    }
    bboxPanel.hidden = false;
    const box = window.PodborkaColors
      ? window.PodborkaColors.normalizeBbox(bbox)
      : bbox;

    const url = '/api/looks/' + encodeURIComponent(lookId) + '/image?t=' + Date.now();
    bboxImage.onload = () => {
      if (!box) {
        bboxBox.hidden = true;
        bboxHint.textContent = 'bbox не получен — цвета считаются по всему кадру';
        bboxMeta.textContent = '';
        return;
      }
      bboxHint.textContent = 'Рамка от vision — цвета считаются только внутри неё';
      bboxBox.hidden = false;
      bboxBox.style.left = box.x * 100 + '%';
      bboxBox.style.top = box.y * 100 + '%';
      bboxBox.style.width = box.w * 100 + '%';
      bboxBox.style.height = box.h * 100 + '%';
      bboxMeta.textContent =
        'bbox: x=' +
        box.x.toFixed(3) +
        ' y=' +
        box.y.toFixed(3) +
        ' w=' +
        box.w.toFixed(3) +
        ' h=' +
        box.h.toFixed(3);
    };
    bboxImage.src = url;
  }

  function renderCutout(lookId, attrs) {
    if (!cutoutPanel) return;
    const cutout = attrs && attrs.cutout;
    const err = attrs && attrs.cutout_error;
    if (!lookId || (!cutout && !err)) {
      cutoutPanel.hidden = true;
      return;
    }
    cutoutPanel.hidden = false;
    if (err && !cutout) {
      cutoutHint.textContent = 'Не удалось убрать фон';
      cutoutMeta.textContent = err;
      cutoutImage.removeAttribute('src');
      cutoutImage.alt = '';
      return;
    }
    cutoutHint.textContent = 'Кроп по bbox → Replicate remove-bg';
    cutoutMeta.textContent = cutout.model
      ? 'модель: ' + cutout.model + (cutout.bytes ? ' · ' + Math.round(cutout.bytes / 1024) + ' KB' : '')
      : '';
    cutoutImage.alt = 'Вещь без фона';
    cutoutImage.src =
      '/api/looks/' + encodeURIComponent(lookId) + '/cutout?t=' + Date.now();
  }

  function renderCopyList(items) {
    const wrap = document.createElement('div');
    wrap.className = 'podborka__swatches';
    if (!items.length) {
      const span = document.createElement('span');
      span.className = 'podborka__block-hint';
      span.textContent = '—';
      wrap.appendChild(span);
      return wrap;
    }
    for (const item of items) {
      const chip = document.createElement('div');
      chip.className = 'podborka__swatch';
      const span = document.createElement('span');
      span.textContent = item;
      chip.append(span, copyBtn(item));
      wrap.appendChild(chip);
    }
    return wrap;
  }

  function renderAttrsView(attrs, actualQueries) {
    attrsRoot.innerHTML = '';
    if (!attrs) {
      attrsPanel.hidden = true;
      return;
    }
    attrsPanel.hidden = false;

    const skip = new Set([
      'key_features',
      'distinctive_features',
      'search_queries',
      'search_queries_sent',
      'cutout',
      'cutout_error',
    ]);

    const grid = document.createElement('div');
    grid.className = 'podborka__attrs-grid';

    const rootKeys = Object.keys(attrs).filter((k) => !skip.has(k));
    for (const key of rootKeys) {
      const item = document.createElement('div');
      item.className = 'podborka__attr-item';

      const label = document.createElement('div');
      label.className = 'podborka__attr-label';
      label.textContent = key;

      const val = document.createElement('div');
      val.className = 'podborka__attr-val';
      val.textContent = formatCellValue(attrs[key]);

      item.append(label, val);
      grid.appendChild(item);
    }
    attrsRoot.appendChild(grid);

    function section(title, node) {
      const wrap = document.createElement('div');
      wrap.style.marginTop = '1rem';
      const h = document.createElement('div');
      h.className = 'podborka__attr-label';
      h.textContent = title;
      wrap.append(h, node);
      attrsRoot.appendChild(wrap);
    }

    const keyFeatures = Array.isArray(attrs.key_features) ? attrs.key_features : [];
    const distinctive = Array.isArray(attrs.distinctive_features)
      ? attrs.distinctive_features
      : [];
    const modelQueries = Array.isArray(attrs.search_queries) ? attrs.search_queries : [];

    if (keyFeatures.length) {
      section('Ключевые особенности', renderCopyList(keyFeatures));
    }
    if (distinctive.length) {
      section('Отличительные черты', renderCopyList(distinctive));
    }
    if (modelQueries.length) {
      section('Поисковые запросы AI', renderCopyList(modelQueries.filter(Boolean)));
    }
    if (actualQueries && actualQueries.length) {
      section('Отправленные запросы', renderCopyList(actualQueries.filter(Boolean)));
    }
  }

  function openColorModal(color) {
    const f = color.formats;
    colorModalSwatch.style.background = f.hex;
    colorModalRows.innerHTML = '';
    const rows = [
      ['HEX', f.hex],
      ['RGB', f.rgb],
      ['R,G,B', f.rgbValues],
      ['HSB', f.hsbValues],
      ['HSL', f.hslValues],
      ['CMYK', f.cmykValues],
    ];

    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'podborka-modal__row';
      const lab = document.createElement('div');
      lab.className = 'podborka-modal__row-label';
      lab.textContent = label;
      const val = document.createElement('div');
      val.className = 'podborka-modal__row-val';
      val.textContent = value;
      row.append(lab, val, copyBtn(value));
      colorModalRows.appendChild(row);
    }
    colorModal.hidden = false;
  }

  function closeColorModal() {
    colorModal.hidden = true;
  }

  colorModal.addEventListener('click', (e) => {
    if (e.target && e.target.hasAttribute('data-close-modal')) closeColorModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !colorModal.hidden) closeColorModal();
  });

  async function renderColors(lookId, bbox) {
    colorSwatches.innerHTML = '';
    if (!lookId || !window.PodborkaColors) {
      colorsPanel.hidden = true;
      return;
    }
    colorsPanel.hidden = false;
    colorSwatches.innerHTML = '<span class="podborka__block-hint">Считаем цвета…</span>';
    try {
      const url = '/api/looks/' + encodeURIComponent(lookId) + '/image?t=' + Date.now();
      const colors = await window.PodborkaColors.extractDominantColors(url, {
        maxColors: 6,
        bbox: bbox || null,
      });
      colorSwatches.innerHTML = '';
      if (!colors.length) {
        colorSwatches.innerHTML =
          '<span class="podborka__block-hint">Не удалось выделить цвета</span>';
        return;
      }
      for (const c of colors) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'podborka__swatch';
        btn.title = c.formats.hex + ' · ' + c.percent + '%';
        const circle = document.createElement('span');
        circle.className = 'podborka__swatch-circle';
        circle.style.background = c.formats.hex;
        const hexSpan = document.createElement('span');
        hexSpan.className = 'podborka__swatch-hex';
        hexSpan.textContent = c.formats.hex;
        const pct = document.createElement('span');
        pct.style.color = '#888';
        pct.textContent = c.percent + '%';
        btn.append(circle, hexSpan, pct);
        btn.addEventListener('click', () => openColorModal(c));
        colorSwatches.appendChild(btn);
      }
    } catch (_) {
      colorSwatches.innerHTML =
        '<span class="podborka__block-hint">Парсинг цветов недоступен</span>';
    }
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = 'podborka__status' + (kind ? ' is-' + kind : '');
  }

  async function api(url, options) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Ошибка ' + res.status);
    }
    return data;
  }

  function formatPrice(cents, currency) {
    if (cents == null) return '';
    const value = (cents / 100).toLocaleString('ru-RU');
    return value + ' ' + (currency || '₽');
  }

  function renderUsage(me) {
    const u = me.usage || {};
    const loggedIn = Boolean(me.user);
    const who = loggedIn
      ? (me.user.displayName || me.user.email)
      : 'Гостевой режим';

    usageEl.textContent =
      who +
      ' · Загрузок сегодня: ' +
      (u.uploadsUsed ?? 0) +
      ' / ' +
      (u.uploadsLimit ?? '—') +
      ' · Офферов: до ' +
      (u.offerLimit ?? '—');

    if (guestLoginPrompt) guestLoginPrompt.hidden = loggedIn;
    if (logoutBtn) logoutBtn.hidden = !loggedIn;
  }

  if (guestLoginPrompt) {
    guestLoginPrompt.addEventListener('click', () => {
      if (window.VeshaAuth) window.VeshaAuth.openModal('login');
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (window.VeshaAuth) await window.VeshaAuth.logout();
      else await api('/api/auth/logout', { method: 'POST' });
    });
  }

  function setUploadBusy(busy) {
    uploadBtn.disabled = Boolean(busy);
    const span = uploadBtn.querySelector('span') || uploadBtn;
    span.textContent = busy ? UPLOAD_BTN_BUSY : UPLOAD_BTN_LABEL;
    uploadBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  async function reprocessActiveLook() {
    if (!activeLookId) return;
    recalcBtn.disabled = true;
    setUploadBusy(true);
    setStatus('Повторный анализ… это может занять минуту');
    try {
      const bundle = await api(
        '/api/looks/' + encodeURIComponent(activeLookId) + '/reprocess',
        { method: 'POST' }
      );
      dedupeNote.hidden = true;
      renderOffers(bundle);
      await refreshHistory();
      if (bundle.look && bundle.look.status === 'failed') {
        setStatus(bundle.look.error || 'Не удалось пересчитать', 'error');
      } else {
        setStatus('Повторный анализ готов', 'ok');
      }
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      recalcBtn.disabled = false;
      setUploadBusy(false);
    }
  }

  recalcBtn.addEventListener('click', () => reprocessActiveLook());

  function getShopKind(shopName) {
    const s = String(shopName || '').toLowerCase();
    if (s.includes('wb') || s.includes('wildberries')) return 'wb';
    if (s.includes('ozon')) return 'ozon';
    if (s.includes('yandex') || s.includes('маркет') || s.includes('market')) return 'yandex';
    return 'other';
  }

  function renderOffers(bundle) {
    resultEl.hidden = false;
    const look = bundle.look || {};
    const extraction = bundle.extraction;
    const attrs = extraction && extraction.attributes ? extraction.attributes : null;
    recalcBtn.hidden = !look.id;
    if (!bundle.deduplicated) dedupeNote.hidden = true;

    const actualQueries = Array.isArray(bundle.searchQueries)
      ? bundle.searchQueries
      : Array.isArray(bundle.searchJobs)
        ? bundle.searchJobs.map((j) => j.query).filter(Boolean)
        : extraction && Array.isArray(extraction.search_queries)
          ? extraction.search_queries
          : [];

    const notClothing = attrs && attrs.is_clothing === false;
    resultMeta.innerHTML =
      '<strong>' +
      escapeHtml(look.title || 'Результат анализа') +
      '</strong> · статус: ' +
      escapeHtml(look.status || '—') +
      (extraction && extraction.provider
        ? ' · AI: ' + escapeHtml(extraction.provider + (extraction.model ? ' (' + extraction.model + ')' : ''))
        : '') +
      (attrs && attrs.category ? ' · ' + escapeHtml(attrs.category) : '') +
      (notClothing
        ? '<br><span style="color:#f87171">На фото не найдена одежда' +
          (attrs.reject_reason ? ': ' + escapeHtml(attrs.reject_reason) : '') +
          '</span>'
        : '') +
      (look.error ? '<br>ошибка: ' + escapeHtml(look.error) : '');

    renderAttrsView(attrs, actualQueries);
    if (look.id) {
      activeLookId = look.id;
      const bbox = attrs && attrs.bbox ? attrs.bbox : null;
      renderBboxPreview(look.id, bbox);
      if (notClothing) {
        colorsPanel.hidden = true;
        if (cutoutPanel) cutoutPanel.hidden = true;
      } else {
        renderColors(look.id, bbox);
        renderCutout(look.id, attrs);
      }
    } else {
      bboxPanel.hidden = true;
      colorsPanel.hidden = true;
      if (cutoutPanel) cutoutPanel.hidden = true;
    }

    offersEl.innerHTML = '';
    const offers = bundle.offers || [];
    if (!offers.length) {
      offersEl.innerHTML = '<p class="podborka__meta" style="grid-column:1/-1;text-align:center;">Офферов пока нет.</p>';
      return;
    }

    for (const o of offers) {
      const a = document.createElement('a');
      a.className = 'podborka__offer';
      a.href = o.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'podborka__offer-thumb-wrap';

      if (o.thumbnailUrl) {
        const img = document.createElement('img');
        img.className = 'podborka__offer-thumb';
        img.src = o.thumbnailUrl;
        img.alt = o.title || '';
        img.loading = 'lazy';
        thumbWrap.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'podborka__offer-thumb podborka__offer-thumb--empty';
        ph.textContent = o.shop || 'Магазин';
        thumbWrap.appendChild(ph);
      }
      a.appendChild(thumbWrap);

      const body = document.createElement('div');
      body.className = 'podborka__offer-body';

      const topRow = document.createElement('div');
      topRow.className = 'podborka__offer-top';

      const shopKind = getShopKind(o.shop);
      const shop = document.createElement('span');
      shop.className = `podborka__offer-shop podborka__offer-shop--${shopKind}`;
      shop.textContent = o.shop || 'Магазин';
      topRow.appendChild(shop);

      if (o.priceCents != null) {
        const price = document.createElement('span');
        price.className = 'podborka__offer-price';
        price.textContent = formatPrice(o.priceCents, o.currency);
        topRow.appendChild(price);
      }
      body.appendChild(topRow);

      const title = document.createElement('h3');
      title.className = 'podborka__offer-title';
      title.textContent = o.title || 'Товар';
      body.appendChild(title);

      if (o.snippet) {
        const p = document.createElement('p');
        p.className = 'podborka__offer-snippet';
        p.textContent = o.snippet;
        body.appendChild(p);
      }

      const btn = document.createElement('span');
      btn.className = 'podborka__offer-btn';
      btn.textContent = 'В магазин →';
      body.appendChild(btn);

      a.appendChild(body);
      offersEl.appendChild(a);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
      });
    } catch (_) {
      return '';
    }
  }

  function renderHistory(looks) {
    historyCarousel.innerHTML = '';
    if (!looks || !looks.length) {
      historyPanel.hidden = true;
      return;
    }
    historyPanel.hidden = false;
    for (const look of looks) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'podborka__history-card' + (look.id === activeLookId ? ' is-active' : '');
      btn.dataset.lookId = look.id;

      const img = document.createElement('img');
      img.src = look.imageUrl + '?t=' + encodeURIComponent(look.updatedAt || look.createdAt || '');
      img.alt = look.title || 'Вещь';
      img.loading = 'lazy';

      const title = document.createElement('div');
      title.className = 'podborka__history-card-title';
      title.textContent = look.title || 'Без названия';

      const meta = document.createElement('div');
      meta.className = 'podborka__history-card-meta';
      meta.textContent =
        formatDate(look.createdAt) +
        (look.offersCount != null ? ' · ' + look.offersCount + ' офф.' : '');

      btn.append(img, title, meta);
      btn.addEventListener('click', () => openLook(look.id));
      historyCarousel.appendChild(btn);
    }
  }

  async function refreshHistory() {
    try {
      const data = await api('/api/looks');
      renderHistory(data.looks || []);
    } catch (_) {
      historyPanel.hidden = true;
    }
  }

  async function openLook(lookId) {
    activeLookId = lookId;
    setStatus('Открываем сохранённую вещь…');
    try {
      const bundle = await api('/api/looks/' + encodeURIComponent(lookId));
      renderOffers(bundle);
      Array.from(historyCarousel.querySelectorAll('.podborka__history-card')).forEach((el) => {
        el.classList.toggle('is-active', el.dataset.lookId === lookId);
      });
      setStatus('Сохранённая подборка', 'ok');
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  carouselPrev.addEventListener('click', () => {
    historyCarousel.scrollBy({ left: -220, behavior: 'smooth' });
  });
  carouselNext.addEventListener('click', () => {
    historyCarousel.scrollBy({ left: 220, behavior: 'smooth' });
  });

  async function refreshMe() {
    const me = window.VeshaAuth ? await window.VeshaAuth.getMe(true) : await api('/api/auth/me');
    renderUsage(me);
    await refreshHistory();
    return me;
  }

  window.addEventListener('auth:change', () => {
    refreshMe().catch(() => {});
  });

  function setFile(file) {
    if (!file) {
      previewWrap.hidden = true;
      dropLabel.hidden = false;
      return;
    }
    const url = URL.createObjectURL(file);
    preview.src = url;
    previewWrap.hidden = false;
    dropLabel.hidden = true;
  }

  imageInput.addEventListener('change', () => {
    const file = imageInput.files && imageInput.files[0];
    setFile(file);
  });

  if (previewClear) {
    previewClear.addEventListener('click', (e) => {
      e.stopPropagation();
      imageInput.value = '';
      setFile(null);
    });
  }

  // Drag and drop handlers
  ['dragenter', 'dragover'].forEach((eventName) => {
    dropLabel.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropLabel.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropLabel.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropLabel.classList.remove('is-dragover');
    });
  });

  dropLabel.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const file = dt && dt.files && dt.files[0];
    if (file) {
      imageInput.files = dt.files;
      setFile(file);
    }
  });

  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = imageInput.files && imageInput.files[0];
    if (!file) {
      setStatus('Выберите изображение одежды', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('image', file);
    setUploadBusy(true);
    recalcBtn.disabled = true;
    setStatus('Анализируем фото и ищем предложения… это может занять минуту');
    try {
      const bundle = await api('/api/looks', { method: 'POST', body: fd });
      activeLookId = bundle.look && bundle.look.id ? bundle.look.id : null;
      renderOffers(bundle);
      await refreshMe();
      if (bundle.look && bundle.look.status === 'failed') {
        setStatus(bundle.look.error || 'Не удалось обработать', 'error');
      } else if (bundle.deduplicated) {
        dedupeNote.hidden = false;
        setStatus('Эта вещь уже была загружена — открыли сохранённую', 'ok');
      } else {
        dedupeNote.hidden = true;
        setStatus('Готово', 'ok');
      }
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      setUploadBusy(false);
      recalcBtn.disabled = false;
    }
  });

  refreshMe().catch((err) => {
    usageEl.textContent = 'Гостевой режим · Загрузок: 0 / 3';
  });
})();
