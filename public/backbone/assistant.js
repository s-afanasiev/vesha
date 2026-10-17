// Виджет ассистента магазина (docs/backbone-architecture.md §6.3, §6.4): кнопка в углу
// витрины → разговор. Наличие и цену, статус своей заявки и часы работы ассистент
// отвечает сразу; список предлагает отправить заявкой (контакт и согласие — здесь же);
// остальное — менеджеру, его ответ придёт сюда же. Решения — на сервере
// (/api/backbone-public/shops/<slug>/assistant…), виджет только показывает и отправляет.
// Сам по себе: не зависит от общего VeshaUI — его можно встроить и на чужую страницу.
(() => {
  'use strict';
  const slug = new URLSearchParams(location.search).get('shop') || 'demo-krepezh';
  const api = `/api/backbone-public/shops/${encodeURIComponent(slug)}/assistant`;
  const POLL_MS = 4000;

  const css = `
    .ast-btn { position: fixed; right: 16px; bottom: 16px; z-index: 50; font: inherit; font-weight: 600; cursor: pointer;
      border: 0; border-radius: 999px; padding: 12px 18px; background: var(--btn-primary-bg, #2563eb); color: var(--btn-primary-text, #fff);
      box-shadow: 0 6px 20px var(--shadow, rgba(0,0,0,.25)); }
    .ast-btn:hover { background: var(--btn-primary-hover, #1d4ed8); }
    .ast { position: fixed; right: 16px; bottom: 16px; z-index: 51; width: 380px; max-width: calc(100vw - 32px);
      height: min(600px, calc(100vh - 32px)); display: none; flex-direction: column; text-align: left;
      background: var(--surface, #fff); color: var(--text, #111); border: 1px solid var(--border, #ddd); border-radius: 14px;
      box-shadow: 0 10px 40px var(--shadow-strong, rgba(0,0,0,.3)); overflow: hidden; }
    .ast--open { display: flex; }
    .ast__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border, #ddd); }
    .ast__title { font-weight: 700; color: var(--text-heading, inherit); }
    .ast__close { font: inherit; font-size: 1.2rem; line-height: 1; cursor: pointer; border: 0; background: none; color: var(--text-muted, #666); padding: 4px 8px; }
    .ast__hint { font-size: 0.8rem; color: var(--text-muted, #666); padding: 8px 14px 0; }
    .ast__msgs { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
    .ast__msg { max-width: 88%; padding: 8px 11px; border-radius: 12px; font-size: 0.9rem; white-space: pre-wrap; overflow-wrap: anywhere; }
    .ast__msg--me { align-self: flex-end; background: var(--btn-primary-bg, #2563eb); color: var(--btn-primary-text, #fff); border-bottom-right-radius: 4px; }
    .ast__msg--shop { align-self: flex-start; background: var(--surface-inset, #f1f3f6); border-bottom-left-radius: 4px; }
    .ast__msg a { color: var(--link, #2563eb); text-decoration: underline; }
    .ast__msg--me a { color: inherit; }
    .ast__msg time { display: block; font-size: 0.7rem; opacity: 0.7; margin-top: 3px; }
    .ast__offer { border-top: 1px solid var(--border, #ddd); padding: 10px 14px; display: grid; gap: 6px; font-size: 0.85rem; background: var(--surface-inset, #f6f7f9); }
    .ast__offer[hidden] { display: none; }
    .ast__offer b { color: var(--text-heading, inherit); }
    .ast__offer input[type=text] { font: inherit; color: var(--text, #111); background: var(--input-bg, #fff); border: 1px solid var(--border, #ddd); border-radius: 8px; padding: 7px 9px; min-width: 0; }
    .ast__consent { display: flex; gap: 6px; align-items: flex-start; color: var(--text-muted, #666); font-size: 0.78rem; }
    .ast__row { display: flex; gap: 6px; }
    .ast__form { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--border, #ddd); }
    .ast__form textarea { flex: 1; min-width: 0; resize: none; height: 42px; font: inherit; font-size: 0.9rem; color: var(--text, #111);
      background: var(--input-bg, #fff); border: 1px solid var(--border, #ddd); border-radius: 8px; padding: 8px 9px; }
    .ast__send, .ast__go { font: inherit; font-weight: 600; cursor: pointer; border: 0; border-radius: 8px; padding: 8px 12px;
      background: var(--btn-primary-bg, #2563eb); color: var(--btn-primary-text, #fff); }
    .ast__later { font: inherit; cursor: pointer; border: 1px solid var(--border, #ddd); border-radius: 8px; padding: 8px 12px; background: var(--input-bg, #fff); color: var(--text, #111); }
    .ast__send[disabled], .ast__go[disabled] { opacity: 0.6; cursor: progress; }
    .ast__err { color: var(--danger-text, #b91c1c); font-size: 0.8rem; padding: 0 14px 8px; min-height: 0; }
    @media (max-width: 520px) { .ast { right: 16px; left: 16px; width: auto; max-width: none; } }
  `;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // Ссылки в ответах — окно статуса заявки и адреса сайта; всё остальное — текст.
  const linked = (s) => esc(s).replace(/(\/backbone\/status\.html\?t=[\w%-]+|https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ast-btn';
  btn.textContent = 'Спросить магазин';
  btn.setAttribute('aria-controls', 'ast');
  const box = document.createElement('section');
  box.className = 'ast';
  box.id = 'ast';
  box.setAttribute('aria-label', 'Ассистент магазина');
  box.innerHTML = `
    <header class="ast__head"><span class="ast__title">Ассистент магазина</span><button type="button" class="ast__close" aria-label="Закрыть">×</button></header>
    <div class="ast__hint">Сразу отвечу о наличии и цене позиции, о вашей заявке и о часах работы. Остальное передам менеджеру — ответ придёт сюда.</div>
    <div class="ast__msgs" aria-live="polite"></div>
    <form class="ast__offer" hidden novalidate>
      <b>Отправить список заявкой</b>
      <input type="text" name="name" maxlength="120" placeholder="Как к вам обращаться" autocomplete="organization">
      <input type="text" name="contact" maxlength="120" placeholder="Почта или телефон для ответа *" autocomplete="email">
      <label class="ast__consent"><input type="checkbox" name="consent" value="on"><span>Согласен на обработку персональных данных (контакт и список), чтобы магазин ответил на заявку. Данные хранятся в России.</span></label>
      <div class="ast__row"><button type="submit" class="ast__go">Отправить заявку</button><button type="button" class="ast__later">Не сейчас</button></div>
    </form>
    <div class="ast__err" role="alert"></div>
    <form class="ast__form" novalidate>
      <textarea name="text" maxlength="4000" placeholder="Например: есть ли болт М10х50?" aria-label="Сообщение"></textarea>
      <button type="submit" class="ast__send">→</button>
    </form>`;
  document.body.append(btn, box);

  const msgs = box.querySelector('.ast__msgs');
  const offerForm = box.querySelector('.ast__offer');
  const form = box.querySelector('.ast__form');
  const input = form.querySelector('textarea');
  const err = box.querySelector('.ast__err');
  let offer = null;
  let dismissed = null; // предложение, от которого отказались, — не показываем снова
  let timer = null;
  let shown = '';

  async function call(path, body) {
    const res = await fetch(api + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function render(talk) {
    const key = JSON.stringify(talk.messages.map((m) => m.id));
    if (key !== shown) {
      shown = key;
      msgs.innerHTML = talk.messages.length
        ? talk.messages.map((m) => `<div class="ast__msg ${m.mine ? 'ast__msg--me' : 'ast__msg--shop'}">${linked(m.text)}<time>${esc(time(m.at))}</time></div>`).join('')
        : '<div class="ast__hint">Напишите вопрос или вставьте список: «наименование — количество», по строке на позицию.</div>';
      msgs.scrollTop = msgs.scrollHeight;
    }
    offer = talk.offer;
    offerForm.hidden = !offer || (dismissed && dismissed === offer.message);
  }

  async function refresh() {
    try { render(await call('')); } catch { /* тихий такт */ }
  }

  function open(yes) {
    box.classList.toggle('ast--open', yes);
    btn.hidden = yes;
    clearInterval(timer);
    if (yes) { refresh(); timer = setInterval(refresh, POLL_MS); input.focus(); }
  }
  btn.addEventListener('click', () => open(true));
  box.querySelector('.ast__close').addEventListener('click', () => open(false));
  box.querySelector('.ast__later').addEventListener('click', () => { dismissed = offer && offer.message; offerForm.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const send = form.querySelector('.ast__send');
    send.disabled = true;
    err.textContent = '';
    try {
      const id = (crypto.randomUUID && crypto.randomUUID()) || `w-${Date.now()}-${Math.random()}`;
      render(await call('/messages', { text, externalId: id }));
      input.value = '';
      input.style.height = '';
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight + 2, 140)}px`; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !/\n/.test(input.value)) { e.preventDefault(); form.requestSubmit(); }
  });

  offerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(offerForm);
    if (!String(data.get('contact') || '').trim()) { err.textContent = 'Укажите почту или телефон для ответа'; return; }
    if (!data.get('consent')) { err.textContent = 'Нужно согласие на обработку персональных данных'; return; }
    const go = offerForm.querySelector('.ast__go');
    go.disabled = true;
    err.textContent = '';
    try {
      await call('/orders', { message: offer.message, name: data.get('name'), contact: data.get('contact'), consent: 'on' });
      offerForm.reset();
      await refresh();
    } catch (ex) {
      err.textContent = `Заявка не отправлена: ${ex.message}`;
    } finally {
      go.disabled = false;
    }
  });
})();
