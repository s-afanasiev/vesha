// Пульт сбора сырых данных 2ГИС — админская вкладка pain-radar (panel-scrape).
// Подгружается динамически: setupAdminConsole в pain-radar.js (part scrape, видимость admin).
// Кнопки: loader до завершения задачи (startJob → промис резолвится в поллинге, когда джоба done).
function initScrapeConsole() {

  const $ = (id) => document.getElementById(id);
  const el = {
    cTotal: $('cTotal'), cMinute: $('cMinute'), cReviews: $('cReviews'), cFiles: $('cFiles'),
    alarm: $('alarm'), jobline: $('jobline'),
    dataDir: $('dataDir'), city: $('city'), applyDir: $('applyDir'), dirStats: $('dirStats'),
    rubricsUrl: $('rubricsUrl'), loadRubrics: $('loadRubrics'), rubrics: $('rubrics'), rubricsInfo: $('rubricsInfo'),
    subUrl: $('subUrl'), loadSubrubrics: $('loadSubrubrics'), subrubrics: $('subrubrics'), subInfo: $('subInfo'),
    listingUrl: $('listingUrl'), maxPages: $('maxPages'), collectOrgs: $('collectOrgs'),
    query: $('query'), searchOrgs: $('searchOrgs'), orgsInfo: $('orgsInfo'),
    selAll: $('selAll'), selNone: $('selNone'), selNoSite: $('selNoSite'), selInfo: $('selInfo'),
    orgsBody: document.querySelector('#orgsTable tbody'),
    maxPerOrg: $('maxPerOrg'), collectReviews: $('collectReviews'), scanSites: $('scanSites'),
    pauseBtn: $('pauseBtn'), limitInfo: $('limitInfo'),
    perBase: $('perBase'), log: $('log'),
  };

  const state = {
    config: { dataDir: 'data/pain-radar-corpus', limits: {} },
    rubricItems: [], subItems: [],
    orgs: [], file: null,
    waitJobs: new Map(), // jobId → handler(job)
    orgJobId: null,
  };
  window.__scrape = state; // отладка пульта

  // ---------- сеть ----------

  async function post(path, body) {
    const res = await fetch(`/api/pain-radar/scrape/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  }

  async function get(path) {
    const res = await fetch(`/api/pain-radar/scrape/${path}`);
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  }

  // джоба: POST → промис резолвится, когда поллинг увидит done/error (результат уже в state.jobs)
  function startJob(path, body, onDone) {
    return post(path, body).then(({ jobId }) => new Promise((resolve) => {
      state.waitJobs.set(jobId, (job) => {
        try { onDone(job); } finally { resolve(job); }
      });
      showJob('запущено…');
    }));
  }

  // loader на кнопках: от клика до фактического завершения задачи
  async function withLoading(buttons, fn) {
    const list = Array.isArray(buttons) ? buttons : [buttons];
    list.forEach((b) => { b.disabled = true; b.classList.add('loading'); });
    try {
      await fn();
    } catch (e) {
      showJob(`ошибка: ${e.message || e}`, 'bad');
    } finally {
      list.forEach((b) => { b.classList.remove('loading'); b.disabled = false; });
    }
  }

  function showJob(text, cls) {
    el.jobline.textContent = text;
    el.jobline.classList.toggle('hidden', !text);
    el.jobline.style.borderColor = cls === 'bad' ? 'var(--prsc-bad, #d86b5a)' : 'var(--prsc-tool, #5a9bd8)';
    el.jobline.style.color = cls === 'bad' ? '#f0c0b6' : '';
  }

  // ---------- рендеры ----------

  function renderOrgs() {
    const rows = state.orgs;
    el.orgsBody.innerHTML = rows.map((o) => {
      const noSite = o.site_scanned && !o.site;
      const siteCell = o.site
        ? `<a href="${escapeHtml(o.site)}" target="_blank" rel="noopener" class="site ok">${escapeHtml(shortHost(o.site))}</a>`
        : (o.site_scanned
          ? '<span class="site">только телефон/соцсети</span>'
          : '<span class="site">—</span>');
      return `<tr data-id="${o.branch_id}" class="${noSite ? 'nosite' : ''}">
        <td><input type="checkbox" class="orgpick" value="${o.branch_id}"></td>
        <td>${escapeHtml(o.name || '')}</td>
        <td class="num">${o.rating ?? '—'}</td>
        <td class="num">${o.reviews_count ?? '—'}</td>
        <td>${siteCell}</td>
        <td>${escapeHtml(o.address || '')}</td>
      </tr>`;
    }).join('');
    updateSelInfo();
  }

  function updateSelInfo() {
    const boxes = [...document.querySelectorAll('.orgpick')];
    const picked = boxes.filter(b => b.checked).length;
    const withSite = state.orgs.filter(o => o.site).length;
    const scanned = state.orgs.filter(o => o.site_scanned).length;
    const noSite = scanned - withSite;
    el.selInfo.textContent = `выбрано ${picked} из ${state.orgs.length} · сайт есть у ${withSite}${scanned ? `, не проверено ${state.orgs.length - scanned}, без сайта ${noSite} — кандидаты на предложение сайта` : ''}`;
  }

  function shortHost(url) {
    try { return new URL(url).host + new URL(url).pathname.replace(/\/$/, ''); } catch { return url; }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fillSelect(sel, items, labelFn) {
    sel.innerHTML = '<option value="">— выберите —</option>' +
      items.map((it, i) => `<option value="${i}">${escapeHtml(labelFn(it))}</option>`).join('');
  }

  function rubricLabel(it) {
    const kind = it.type === 'metarubric' ? '[группа]' : `[${it.branch_count ?? '?'} мест]`;
    return `${it.name} ${kind}`;
  }

  function applyCity() {
    const city = el.city.value.trim() || 'kursk';
    el.rubricsUrl.textContent = `https://2gis.ru/${city}/rubrics`;
    const rub = currentRubric();
    el.subUrl.textContent = rub ? `https://2gis.ru/${city}/rubrics/subrubrics/${rub.id}` : '—';
  }

  function currentRubric() { return state.rubricItems[el.rubrics.value]; }
  function currentSub() { return state.subItems[el.subrubrics.value]; }

  // ---------- обработчики ----------

  el.applyDir.addEventListener('click', async () => {
    try {
      await post('config', { dataDir: el.dataDir.value.trim() });
      el.dirStats.textContent = 'папка применена';
    } catch (e) { el.dirStats.textContent = `ошибка: ${e.message}`; }
  });

  el.city.addEventListener('input', applyCity);

  el.loadRubrics.addEventListener('click', () => withLoading(el.loadRubrics, async () => {
    await startJob('rubrics', { city: el.city.value.trim() || 'kursk', dataDir: el.dataDir.value.trim() }, (job) => {
      if (job.status === 'error') { el.rubricsInfo.textContent = `ошибка: ${job.error}`; return; }
      state.rubricItems = job.result.items;
      fillSelect(el.rubrics, state.rubricItems, rubricLabel);
      el.rubricsInfo.textContent = `найдено рубрик: ${job.result.count} (группы с подрубриками помечены [группа])`;
    });
  }));

  el.loadSubrubrics.addEventListener('click', () => {
    // работает с тем, что выбрано сейчас: подрубрика-[группа] → раскрыть её; иначе — рубрику блока 2
    const sub = currentSub();
    const target = sub && sub.type === 'metarubric' ? sub : currentRubric();
    if (!target) { el.subInfo.textContent = 'сначала обнови рубрики (блок 2) и выбери рубрику'; return; }
    if (target.type === 'rubric') { el.subInfo.textContent = `«${target.name}» — конечная рубрика, её собирают сразу кнопкой «Собрать организации»`; return; }
    return withLoading(el.loadSubrubrics, async () => {
      await revealGroup(target.id, el.city.value.trim() || 'kursk');
    });
  });

  // раскрыть группу подрубрик (job subrubrics) и авто-выбрать первую конечную [N мест]
  function revealGroup(groupId, city) {
    return startJob('subrubrics', { city, groupId, dataDir: el.dataDir.value.trim() }, (job) => {
      if (job.status === 'error') { el.subInfo.textContent = `ошибка: ${job.error}`; return; }
      state.subItems = job.result.items;
      fillSelect(el.subrubrics, state.subItems, rubricLabel);
      el.subUrl.textContent = job.result.url;
      const firstRubricIdx = state.subItems.findIndex((it) => it.type === 'rubric');
      if (firstRubricIdx >= 0) el.subrubrics.value = String(firstRubricIdx);
      const chosen = currentSub();
      el.subInfo.textContent = chosen && chosen.type === 'rubric'
        ? `подрубрик: ${job.result.count} · к сбору готова: ${chosen.name} [${chosen.branch_count ?? '?'} мест] — жми «Собрать организации»`
        : `подрубрик: ${job.result.count} · внутри только группы — раскрывай дальше`;
    });
  }

  // «Собрать организации» сам доводит до цели: раскрывает пустой блок 3 и группы,
  // конечная [N мест] собирается сразу.
  async function collect() {
    const city = el.city.value.trim() || 'kursk';
    let sub = currentSub();
    if (!sub) {
      const rub = currentRubric();
      if (!rub) { el.orgsInfo.textContent = 'сначала обнови рубрики (блок 2) и выбери рубрику'; return; }
      el.orgsInfo.textContent = `подрубрики ещё не загружены — раскрываю группу «${rub.name}»…`;
      await revealGroup(rub.id, city);
      sub = currentSub();
    }
    if (sub.type === 'metarubric') {
      el.orgsInfo.textContent = `«${sub.name}» — группа, а не листинг: раскрываю её подрубрики…`;
      await revealGroup(sub.id, city);
      sub = currentSub();
      if (!sub || sub.type !== 'rubric') { el.orgsInfo.textContent = 'внутри этой группы нет конечных рубрик — выбери вложенную группу и раскрой её'; return; }
    }
    const target = { slug: sub.name, rubricId: sub.id };
    el.listingUrl.textContent = `https://2gis.ru/${city}/search/${encodeURIComponent(target.slug)}/rubricId/${target.rubricId}`;
    await startJob('listing', {
      city, slug: target.slug, rubricId: target.rubricId,
      maxPages: clamp(el.maxPages.value, 1, 20), dataDir: el.dataDir.value.trim(),
    }, (job) => {
      if (job.status === 'error') { el.orgsInfo.textContent = `ошибка: ${job.error}`; return; }
      state.orgs = job.result.items;
      state.file = job.result.file;
      el.orgsInfo.textContent = `всего мест в рубрике: ${job.result.total ?? '?'} · собрано: ${job.result.collected} (файл ${job.result.file})`;
      renderOrgs();
    });
  }

  el.collectOrgs.addEventListener('click', () => withLoading([el.collectOrgs, el.searchOrgs], collect()));

  el.searchOrgs.addEventListener('click', () => {
    const q = el.query.value.trim();
    if (!q) { el.orgsInfo.textContent = 'введите текст запроса'; return; }
    const city = el.city.value.trim() || 'kursk';
    el.listingUrl.textContent = `https://2gis.ru/${city}/search/${encodeURIComponent(q)}`;
    return withLoading([el.collectOrgs, el.searchOrgs], async () => {
      await startJob('search', {
        city, query: q, maxPages: clamp(el.maxPages.value, 1, 20), dataDir: el.dataDir.value.trim(),
      }, (job) => {
        if (job.status === 'error') { el.orgsInfo.textContent = `ошибка: ${job.error}`; return; }
        state.orgs = job.result.items;
        state.file = job.result.file;
        el.orgsInfo.textContent = `всего найдено: ${job.result.total ?? '?'} · собрано: ${job.result.collected} (файл ${job.result.file})`;
        renderOrgs();
      });
    });
  });

  function clamp(v, min, max) { v = Number(v) || min; return Math.min(Math.max(v, min), max); }

  function pickedIds() {
    return [...document.querySelectorAll('.orgpick:checked')].map(b => b.value);
  }

  el.selAll.addEventListener('click', () => { setChecks(true); });
  el.selNone.addEventListener('click', () => { setChecks(false); });
  el.selNoSite.addEventListener('click', () => {
    setChecks(false);
    document.querySelectorAll('#orgsTable tbody tr').forEach(tr => {
      if (tr.classList.contains('nosite')) tr.querySelector('.orgpick').checked = true;
    });
    updateSelInfo();
  });
  function setChecks(v) {
    document.querySelectorAll('.orgpick').forEach(b => { b.checked = v; });
    updateSelInfo();
  }
  el.orgsBody.addEventListener('change', (e) => { if (e.target.classList.contains('orgpick')) updateSelInfo(); });

  el.collectReviews.addEventListener('click', () => {
    const ids = pickedIds();
    if (!ids.length) { showJob('не выбрано ни одной организации — отметьте чекбоксы в таблице блока 4', 'bad'); return; }
    if (ids.length > 120) { showJob('максимум 120 организаций за раз', 'bad'); return; }
    return withLoading(el.collectReviews, async () => {
      await startJob('reviews', {
        city: el.city.value.trim() || 'kursk', branchIds: ids,
        maxPerOrg: clamp(el.maxPerOrg.value, 1, 300), dataDir: el.dataDir.value.trim(),
      }, (job) => {
        if (job.status === 'error') { showJob(`ошибка: ${job.error}`, 'bad'); return; }
        showJob(`готово: отзывов скачано ${job.result.savedTotal}`);
      });
    });
  });

  el.scanSites.addEventListener('click', () => {
    const ids = pickedIds();
    if (!ids.length) { showJob('не выбрано ни одной организации — отметьте чекбоксы в таблице блока 4', 'bad'); return; }
    return withLoading(el.scanSites, async () => {
      await startJob('firm', { city: el.city.value.trim() || 'kursk', branchIds: ids, dataDir: el.dataDir.value.trim() }, (job) => {
        if (job.status === 'error') { showJob(`ошибка: ${job.error}`, 'bad'); return; }
        const byId = new Map(job.result.items.map(o => [o.branch_id, o]));
        state.orgs = state.orgs.map(o => {
          const upd = byId.get(o.branch_id);
          return upd ? { ...o, site: upd.site, site_scanned: true, phones: upd.phones, socials: upd.socials } : o;
        });
        renderOrgs();
        showJob(`контакты проверены: ${job.result.scanned}`);
      });
    });
  });

  el.pauseBtn.addEventListener('click', async () => {
    const { paused } = await post('pause', { paused: !state.pausedNow });
    state.pausedNow = paused;
    el.pauseBtn.textContent = paused ? 'Продолжить' : 'Пауза';
  });

  // ---------- поллинг ----------

  let timer = 0;
  function poll() {
    clearTimeout(timer);
    fetch('/api/pain-radar/scrape/state')
      .then(r => r.json())
      .then((s) => {
        state.pausedNow = s.paused;
        el.pauseBtn.textContent = s.paused ? 'Продолжить' : 'Пауза';
        el.cTotal.textContent = s.counters.total;
        el.cMinute.textContent = s.counters.perMinute;
        el.cFiles.textContent = s.fileStats.ndjsonLines;
        el.dirStats.textContent = `папка: ${s.fileStats.dataDir} · raw-файлов ${s.fileStats.rawFiles} · orgs-файлов ${s.fileStats.orgFiles}`;
        el.limitInfo.textContent = `лимиты: троттлинг ${s.config.limits.minIntervalMs} мс · ≤ ${s.config.limits.maxPages} страниц · ≤ ${s.config.limits.maxReviewsPerOrg} отзывов/орг · стоп сессии при ${s.config.limits.sessionLimit} обращений`;
        el.alarm.classList.toggle('hidden', !s.blockReason);
        if (s.blockReason) el.alarm.textContent = `⛔ ${s.blockReason}`;
        el.cReviews.textContent = (s.counters.byKind && s.counters.byKind.reviews) || 0;

        el.perBase.innerHTML = (s.perBase || []).map(p =>
          `<li>${p.count} × ${escapeHtml(p.base)}</li>`).join('') || '<li>—</li>';
        el.log.innerHTML = (s.log || []).slice().reverse().map(l => {
          const cls = l.status === 200 ? 's200' : (l.status === 403 || l.status === 429 ? 'sbad' : 'swarn');
          const t = (l.ts || '').slice(11, 19);
          return `<span class="${cls}">${t} [${l.kind}] ${l.status} ${l.ms}мс</span> ${escapeHtml(shorten(l.url))}`;
        }).join('\n');

        if (s.current) {
          const p = s.current.progress || {};
          showJob(`${s.current.label} — ${p.done ?? 0}/${p.total ?? '?'}${p.reviews != null ? ` · отзывов ${p.reviews}` : ''}`);
        }

        // завершённые джобы, которых ждём — результат уже в state
        for (const j of s.jobs || []) {
          if (state.waitJobs.has(j.id) && (j.status === 'done' || j.status === 'error')) {
            const handler = state.waitJobs.get(j.id);
            state.waitJobs.delete(j.id);
            try { handler(j); } catch (e) { showJob(`ошибка рендера: ${e.message || e}`, 'bad'); }
          }
        }
      })
      .catch((e) => { showJob(`ошибка поллинга: ${e.message || e}`, 'bad'); })
      .finally(() => { timer = setTimeout(poll, 1000); });
  }

  function shorten(url) {
    if (!url) return '';
    return url.replace(/key=[0-9a-f-]+/, 'key=…').replace(/https?:\/\//, '');
  }

  poll();
  applyCity();
}
