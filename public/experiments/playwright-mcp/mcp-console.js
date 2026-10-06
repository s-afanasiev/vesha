// Песочница Playwright MCP: POST /run + поллинг /state?since=<seq>, приращения дописываются в textarea.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = { task: $('task'), headless: $('headless'), run: $('run'), stop: $('stop'), log: $('log') };
  const chips = { conn: $('chip-conn'), busy: $('chip-busy'), tools: $('chip-tools'), lines: $('chip-lines') };

  let lastSeq = 0;
  let polling = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function appendLog(entries) {
    if (!entries.length) return;
    const stick = el.log.scrollTop + el.log.clientHeight >= el.log.scrollHeight - 40;
    const html = entries.map((l) =>
      `<div class="k-${l.kind}"><span class="t">${l.ts.slice(11, 19)}</span> ${escapeHtml(l.text)}</div>`
    ).join('');
    el.log.insertAdjacentHTML('beforeend', html);
    if (stick) el.log.scrollTop = el.log.scrollHeight;
    chips.lines.innerHTML = `строк лога: <b>${lastSeq}</b>`;
  }

  async function poll() {
    try {
      const res = await fetch(`/api/playwright-mcp/state?since=${lastSeq}`);
      const s = await res.json();
      chips.conn.innerHTML = s.connected ? 'MCP: <b>подключен</b>' : 'MCP: <b>не подключен</b>';
      chips.conn.className = 'chip ' + (s.connected ? 'ok' : '');
      chips.busy.innerHTML = `задача: <b>${s.busy ? 'выполняется' : 'нет'}</b>`;
      chips.busy.className = 'chip ' + (s.busy ? 'err' : '');
      chips.tools.innerHTML = `инструментов: <b>${s.connected ? s.tools.length : '—'}</b>`;
      el.run.disabled = s.busy;
      appendLog(s.log);
    } catch {}
    setTimeout(poll, 1000);
  }

  el.run.addEventListener('click', async () => {
    if (polling) return;
    polling = true;
    el.run.disabled = true;
    try {
      const res = await fetch('/api/playwright-mcp/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: el.task.value, headless: el.headless.checked }),
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || res.status);
    } catch (e) {
      appendLog([{ ts: new Date().toISOString(), seq: ++lastSeq, kind: 'error', text: 'не отправлено: ' + (e.message || e) }]);
      polling = false;
      el.run.disabled = false;
    }
  });

  el.task.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.run.click(); });

  el.stop.addEventListener('click', async () => {
    el.stop.disabled = true;
    try {
      await fetch('/api/playwright-mcp/stop', { method: 'POST' });
    } finally {
      el.stop.disabled = false;
    }
  });

  poll();
})();
