// Пульт сбора сырых данных 2ГИС — админская вкладка pain-radar (panel-scrape).
// Подгружается динамически: setupAdminConsole в pain-radar.js (part scrape, видимость admin).
// Механика джоб (POST → jobId → поллинг → loader кнопок → jobline) — общий
// console@1 из /c/console.js; здесь только домен: рубрики, таблица, отрисовка состояния.
// Таблица организаций — компонент table@1 <v-table src="/api/pain-radar/c/orgs">:
// сортировка/поиск/выбор живут в рендерере, консоль слушает v-select/v-action.
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
    orgsTable: $('orgsTable'),
    maxPerOrg: $('maxPerOrg'), collectReviews: $('collectReviews'),
    pauseBtn: $('pauseBtn'), limitInfo: $('limitInfo'),
    perBase: $('perBase'), log: $('log'),
  };

  const state = {
    config: { dataDir: 'data/pain-radar-corpus', limits: {} },
    rubricItems: [], subItems: [],
    pickedIds: [],            // строки, выбранные в таблице (событие v-select)
  };
  window.__scrape = state; // отладка пульта

  // ---------- консоль джоб: общий console@1 (/c/console.js) ----------

  const jc = new VeshaUI.JobConsole({
    base: '/api/pain-radar/scrape',
    jobline: el.jobline,
    onState: renderState,     // доменная отрисовка состояния (объявлена ниже)
  }).run();

  // ---------- рендеры ----------

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
      await jc.post('config', { dataDir: el.dataDir.value.trim() });
      el.dirStats.textContent = 'папка применена';
    } catch (e) { el.dirStats.textContent = `ошибка: ${e.message}`; }
  });

  el.city.addEventListener('input', applyCity);

  el.loadRubrics.addEventListener('click', () => jc.withLoading(el.loadRubrics, async () => {
    await jc.startJob('rubrics', { city: el.city.value.trim() || 'kursk', dataDir: el.dataDir.value.trim() }, (job) => {
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
    return jc.withLoading(el.loadSubrubrics, async () => {
      await revealGroup(target.id, el.city.value.trim() || 'kursk');
    });
  });

  // раскрыть группу подрубрик (job subrubrics) и авто-выбрать первую конечную [N мест]
  function revealGroup(groupId, city) {
    return jc.startJob('subrubrics', { city, groupId, dataDir: el.dataDir.value.trim() }, (job) => {
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
    await jc.startJob('listing', {
      city, slug: target.slug, rubricId: target.rubricId,
      maxPages: clamp(el.maxPages.value, 1, 20), dataDir: el.dataDir.value.trim(),
    }, (job) => {
      if (job.status === 'error') { el.orgsInfo.textContent = `ошибка: ${job.error}`; return; }
      el.orgsInfo.textContent = `всего мест в рубрике: ${job.result.total ?? '?'} · собрано: ${job.result.collected} (файл ${job.result.file})`;
      el.orgsTable.refresh(); // таблица читает свежий orgs-файл на сервере
    });
  }

  el.collectOrgs.addEventListener('click', () => jc.withLoading([el.collectOrgs, el.searchOrgs], collect()));

  el.searchOrgs.addEventListener('click', () => {
    const q = el.query.value.trim();
    if (!q) { el.orgsInfo.textContent = 'введите текст запроса'; return; }
    const city = el.city.value.trim() || 'kursk';
    el.listingUrl.textContent = `https://2gis.ru/${city}/search/${encodeURIComponent(q)}`;
    return jc.withLoading([el.collectOrgs, el.searchOrgs], async () => {
      await jc.startJob('search', {
        city, query: q, maxPages: clamp(el.maxPages.value, 1, 20), dataDir: el.dataDir.value.trim(),
      }, (job) => {
        if (job.status === 'error') { el.orgsInfo.textContent = `ошибка: ${job.error}`; return; }
        el.orgsInfo.textContent = `всего найдено: ${job.result.total ?? '?'} · собрано: ${job.result.collected} (файл ${job.result.file})`;
        el.orgsTable.refresh();
      });
    });
  });

  function clamp(v, min, max) { v = Number(v) || min; return Math.min(Math.max(v, min), max); }

  // выбор в таблице-компоненте (клиентское состояние) и её bulk-действия
  el.orgsTable.addEventListener('v-select', (e) => { state.pickedIds = e.detail.ids; });

  el.orgsTable.addEventListener('v-action', (e) => {
    const { id, response, error } = e.detail;
    if (error) { jc.showJob(`ошибка: ${error}`, 'bad'); return; }
    const jobId = response && response.result && response.result.jobId;
    if (id === 'scan-sites' && jobId) {
      jc.awaitJob(jobId, (job) => {
        if (job.status === 'error') { jc.showJob(`ошибка: ${job.error}`, 'bad'); return; }
        el.orgsTable.refresh(); // контакты влиты в orgs-файл, перечитываем
        const noSite = (job.result.items || []).filter((o) => o.site_scanned && !o.site).length;
        jc.showJob(`контакты проверены: ${job.result.scanned}${noSite ? ` · без сайта ${noSite} — кандидаты на предложение сайта` : ''}`);
      });
    }
  });

  el.collectReviews.addEventListener('click', () => {
    const ids = state.pickedIds;
    if (!ids.length) { jc.showJob('не выбрано ни одной организации — отметьте чекбоксы в таблице блока 4', 'bad'); return; }
    if (ids.length > 120) { jc.showJob('максимум 120 организаций за раз', 'bad'); return; }
    return jc.withLoading(el.collectReviews, async () => {
      await jc.startJob('reviews', {
        city: el.city.value.trim() || 'kursk', branchIds: ids,
        maxPerOrg: clamp(el.maxPerOrg.value, 1, 300), dataDir: el.dataDir.value.trim(),
      }, (job) => {
        if (job.status === 'error') { jc.showJob(`ошибка: ${job.error}`, 'bad'); return; }
        jc.showJob(`готово: отзывов скачано ${job.result.savedTotal}`);
      });
    });
  });

  el.pauseBtn.addEventListener('click', async () => {
    const { paused } = await jc.post('pause', { paused: !jc.pausedNow });
    jc.pausedNow = paused;
    el.pauseBtn.textContent = paused ? 'Продолжить' : 'Пауза';
  });

  // ---------- отрисовка состояния (вызывается из поллинга console@1) ----------

  function renderState(s) {
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
      jc.showJob(`${s.current.label} — ${p.done ?? 0}/${p.total ?? '?'}${p.reviews != null ? ` · отзывов ${p.reviews}` : ''}`);
    }
  }

  function shorten(url) {
    if (!url) return '';
    return url.replace(/key=[0-9a-f-]+/, 'key=…').replace(/https?:\/\//, '');
  }

  applyCity();
}
