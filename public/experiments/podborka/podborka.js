(function () {
  const usageEl = document.getElementById('usage');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const googleBtn = document.getElementById('google-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const uploadForm = document.getElementById('upload-form');
  const imageInput = document.getElementById('image-input');
  const previewWrap = document.getElementById('preview-wrap');
  const preview = document.getElementById('preview');
  const uploadBtn = document.getElementById('upload-btn');
  const statusEl = document.getElementById('status');
  const resultEl = document.getElementById('result');
  const resultMeta = document.getElementById('result-meta');
  const offersEl = document.getElementById('offers');

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
    loginForm.hidden = loggedIn;
    registerForm.hidden = loggedIn;
    logoutBtn.hidden = !loggedIn;
    googleBtn.hidden = loggedIn || !me.googleEnabled;
  }

  function renderOffers(bundle) {
    resultEl.hidden = false;
    const look = bundle.look || {};
    const extraction = bundle.extraction;
    const attrs = extraction && extraction.attributes ? extraction.attributes : null;
    const queries =
      extraction && extraction.search_queries
        ? extraction.search_queries.join(' · ')
        : '';

    resultMeta.innerHTML =
      '<strong>' +
      escapeHtml(look.title || 'Результат') +
      '</strong> · статус: ' +
      escapeHtml(look.status || '—') +
      (attrs && attrs.category ? ' · ' + escapeHtml(attrs.category) : '') +
      (queries ? '<br>запросы: ' + escapeHtml(queries) : '') +
      (look.error ? '<br>ошибка: ' + escapeHtml(look.error) : '');

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

  async function refreshMe() {
    const me = await api('/api/auth/me');
    renderUsage(me);
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
      await refreshMe();
      setStatus('Аккаунт создан', 'ok');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
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
    uploadBtn.disabled = true;
    setStatus('Анализируем и ищем… это может занять минуту');
    try {
      const bundle = await api('/api/looks', { method: 'POST', body: fd });
      renderOffers(bundle);
      await refreshMe();
      if (bundle.look && bundle.look.status === 'failed') {
        setStatus(bundle.look.error || 'Не удалось обработать', 'error');
      } else {
        setStatus('Готово', 'ok');
      }
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      uploadBtn.disabled = false;
    }
  });

  refreshMe().catch((err) => {
    usageEl.textContent = 'Не удалось связаться с API: ' + err.message;
  });
})();
