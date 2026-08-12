(function () {
  const usageEl = document.getElementById('usage');
  const authForms = document.getElementById('auth-forms');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const googleBtn = document.getElementById('google-btn');
  const logoutBtn = document.getElementById('logout-btn');

  function setAuthTab(name) {
    const isLogin = name === 'login';
    tabLogin.classList.toggle('is-active', isLogin);
    tabRegister.classList.toggle('is-active', !isLogin);
    tabLogin.setAttribute('aria-selected', isLogin ? 'true' : 'false');
    tabRegister.setAttribute('aria-selected', isLogin ? 'false' : 'true');
    loginForm.hidden = !isLogin;
    registerForm.hidden = isLogin;
  }

  tabLogin.addEventListener('click', () => setAuthTab('login'));
  tabRegister.addEventListener('click', () => setAuthTab('register'));
  const uploadForm = document.getElementById('upload-form');
  const imageInput = document.getElementById('image-input');
  const previewWrap = document.getElementById('preview-wrap');
  const preview = document.getElementById('preview');
  const uploadBtn = document.getElementById('upload-btn');
  const statusEl = document.getElementById('status');
  const resultEl = document.getElementById('result');
  const resultMeta = document.getElementById('result-meta');
  const recalcBtn = document.getElementById('recalc-btn');
  const dedupeNote = document.getElementById('dedupe-note');
  const colorsPanel = document.getElementById('colors-panel');
  const UPLOAD_BTN_LABEL = 'Найти где купить';
  const UPLOAD_BTN_BUSY = 'Ищем…';
  const colorSwatches = document.getElementById('color-swatches');
  const attrsPanel = document.getElementById('attrs-panel');
  const attrsRoot = document.getElementById('attrs-root');
  const bboxPanel = document.getElementById('bbox-panel');
  const bboxFrame = document.getElementById('bbox-frame');
  const bboxImage = document.getElementById('bbox-image');
  const bboxBox = document.getElementById('bbox-box');
  const bboxMeta = document.getElementById('bbox-meta');
  const bboxHint = document.getElementById('bbox-hint');
  const offersEl = document.getElementById('offers');
  const historyPanel = document.getElementById('history-panel');
  const historyCarousel = document.getElementById('history-carousel');
  const carouselPrev = document.getElementById('carousel-prev');
  const carouselNext = document.getElementById('carousel-next');
  const colorModal = document.getElementById('color-modal');
  const colorModalSwatch = document.getElementById('color-modal-swatch');
  const colorModalRows = document.getElementById('color-modal-rows');
  let activeLookId = null;

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

  function renderCopyList(items) {
    const ul = document.createElement('ul');
    ul.className = 'podborka__copy-list';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'podborka__copy-text';
      li.textContent = '—';
      ul.appendChild(li);
      return ul;
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.appendChild(copyBtn(item));
      const span = document.createElement('span');
      span.className = 'podborka__copy-text';
      span.textContent = item;
      li.appendChild(span);
      ul.appendChild(li);
    }
    return ul;
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
    ]);
    const table = document.createElement('table');
    table.className = 'podborka__attrs-table';
    const tbody = document.createElement('tbody');
    const rootKeys = Object.keys(attrs).filter((k) => !skip.has(k));
    for (const key of rootKeys) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = key;
      const td = document.createElement('td');
      td.textContent = formatCellValue(attrs[key]);
      tr.append(th, td);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    attrsRoot.appendChild(table);

    function section(title, node) {
      const wrap = document.createElement('div');
      wrap.className = 'podborka__attrs-section';
      const h = document.createElement('h3');
      h.textContent = title;
      wrap.append(h, node);
      attrsRoot.appendChild(wrap);
    }

    const keyFeatures = Array.isArray(attrs.key_features) ? attrs.key_features : [];
    const distinctive = Array.isArray(attrs.distinctive_features)
      ? attrs.distinctive_features
      : [];
    const modelQueries = Array.isArray(attrs.search_queries) ? attrs.search_queries : [];

    const ulKey = document.createElement('ul');
    ulKey.className = 'podborka__attrs-list';
    if (!keyFeatures.length) {
      const li = document.createElement('li');
      li.textContent = '—';
      ulKey.appendChild(li);
    } else {
      keyFeatures.forEach((f) => {
        const li = document.createElement('li');
        li.textContent = f;
        ulKey.appendChild(li);
      });
    }
    section('key_features', ulKey);

    const ulDist = document.createElement('ul');
    ulDist.className = 'podborka__attrs-list';
    if (!distinctive.length) {
      const li = document.createElement('li');
      li.textContent = '—';
      ulDist.appendChild(li);
    } else {
      distinctive.forEach((f) => {
        const li = document.createElement('li');
        li.textContent = f;
        ulDist.appendChild(li);
      });
    }
    section('distinctive_features', ulDist);

    section('search_queries', renderCopyList(modelQueries.filter(Boolean)));
    section(
      'search_queries_sent',
      renderCopyList((actualQueries || []).filter(Boolean))
    );
  }

  function openColorModal(color) {
    const f = color.formats;
    colorModalSwatch.style.background = f.hex;
    colorModalRows.innerHTML = '';
    const rows = [
      ['HEX', f.hex],
      ['RGB', f.rgb],
      ['RGB', f.rgbValues],
      ['HSB', f.hsbValues],
      ['HSL', f.hslValues],
      ['CMYK', f.cmykValues],
    ];
    // Avoid duplicate RGB label confusion — first RGB formatted, second values
    rows[1][0] = 'RGB';
    rows[2][0] = 'R,G,B';

    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'podborka-modal__row';
      const lab = document.createElement('div');
      lab.className = 'podborka-modal__row-label';
      lab.textContent = label;
      const val = document.createElement('div');
      val.className = 'podborka-modal__row-value';
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
          '<span class="podborka__block-hint">Не удалось выделить цвета в bbox</span>';
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
        const pct = document.createElement('span');
        pct.className = 'podborka__swatch-pct';
        pct.textContent = c.percent + '%';
        btn.append(circle, pct);
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
    if (kind) statusEl.dataset.kind = kind;
    else delete statusEl.dataset.kind;
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
    return value + ' ' + (currency || 'RUB');
  }

  function renderUsage(me) {
    const u = me.usage || {};
    const who = me.user
      ? 'Вы вошли как ' + (me.user.displayName || me.user.email)
      : 'Гостевой режим (ограниченные возможности)';
    usageEl.textContent =
      who +
      ' · загрузок сегодня: ' +
      (u.uploadsUsed ?? 0) +
      ' / ' +
      (u.uploadsLimit ?? '—') +
      ' · офферов в выдаче: до ' +
      (u.offerLimit ?? '—');

    const loggedIn = Boolean(me.user);
    authForms.hidden = loggedIn;
    logoutBtn.hidden = !loggedIn;
    googleBtn.hidden = loggedIn || !me.googleEnabled;
    if (!loggedIn && loginForm.hidden && registerForm.hidden) {
      setAuthTab('login');
    }
  }

  function setUploadBusy(busy) {
    uploadBtn.disabled = Boolean(busy);
    uploadBtn.textContent = busy ? UPLOAD_BTN_BUSY : UPLOAD_BTN_LABEL;
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
      escapeHtml(look.title || 'Результат') +
      '</strong> · статус: ' +
      escapeHtml(look.status || '—') +
      (extraction && extraction.provider
        ? ' · ' + escapeHtml(extraction.provider + (extraction.model ? ' / ' + extraction.model : ''))
        : '') +
      (attrs && attrs.category ? ' · ' + escapeHtml(attrs.category) : '') +
      (notClothing
        ? '<br><span style="color:#b44545">На фото не найдена одежда' +
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
      } else {
        renderColors(look.id, bbox);
      }
    } else {
      bboxPanel.hidden = true;
      colorsPanel.hidden = true;
    }

    offersEl.innerHTML = '';
    const offers = bundle.offers || [];
    if (!offers.length) {
      offersEl.innerHTML = '<p class="podborka__meta">Офферов пока нет.</p>';
      return;
    }

    for (const o of offers) {
      const a = document.createElement('a');
      a.className = 'podborka__offer';
      a.href = o.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';

      if (o.thumbnailUrl) {
        const img = document.createElement('img');
        img.className = 'podborka__offer-thumb';
        img.src = o.thumbnailUrl;
        img.alt = '';
        a.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'podborka__offer-thumb podborka__offer-thumb--empty';
        ph.textContent = o.shop || 'shop';
        a.appendChild(ph);
      }

      const body = document.createElement('div');
      const h3 = document.createElement('h3');
      h3.textContent = o.title;
      const p = document.createElement('p');
      p.textContent = [formatPrice(o.priceCents, o.currency), o.snippet]
        .filter(Boolean)
        .join(' — ');
      const shop = document.createElement('span');
      shop.className = 'podborka__offer-shop';
      shop.textContent = o.shop || 'other';
      body.append(h3, p, shop);
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
    historyCarousel.scrollBy({ left: -280, behavior: 'smooth' });
  });
  carouselNext.addEventListener('click', () => {
    historyCarousel.scrollBy({ left: 280, behavior: 'smooth' });
  });

  async function refreshMe() {
    const me = await api('/api/auth/me');
    renderUsage(me);
    await refreshHistory();
    return me;
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(loginForm);
    try {
      setStatus('Вход…');
      await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: fd.get('email'),
          password: fd.get('password'),
        }),
      });
      activeLookId = null;
      await refreshMe();
      setStatus('Вход выполнен', 'ok');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(registerForm);
    try {
      setStatus('Регистрация…');
      await api('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: fd.get('displayName'),
          email: fd.get('email'),
          password: fd.get('password'),
        }),
      });
      activeLookId = null;
      await refreshMe();
      setStatus('Аккаунт создан', 'ok');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      activeLookId = null;
      resultEl.hidden = true;
      await refreshMe();
      setStatus('Вы вышли', 'ok');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });

  imageInput.addEventListener('change', () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) {
      previewWrap.hidden = true;
      return;
    }
    const url = URL.createObjectURL(file);
    preview.src = url;
    previewWrap.hidden = false;
  });

  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = imageInput.files && imageInput.files[0];
    if (!file) {
      setStatus('Выберите изображение', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('image', file);
    setUploadBusy(true);
    recalcBtn.disabled = true;
    setStatus('Анализируем и ищем… это может занять минуту');
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
    usageEl.textContent = 'Не удалось связаться с API: ' + err.message;
  });
})();
