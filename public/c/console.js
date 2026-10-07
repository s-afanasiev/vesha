// console@1 — механика джоб-консоли (docs/ui-components.md §4): кнопки →
// POST → jobId → поллинг состояния → промис по done/error; loader на кнопках
// от клика до фактического завершения джобы; строка статуса jobline.
// Домен отвечает «что делать» (onState рисует свою панель), каркас — «как
// ждать». Поллинг рекурсивным setTimeout, не setInterval.
// Требует /c/ui.js (getJson/postJson). Стиль jobline — у страницы; ошибка
// помечается классом is-bad.
(function () {
  'use strict';
  const { getJson, postJson } = window.VeshaUI;

  class JobConsole {
    // base: '/api/<ns>/scrape' — префикс POST-ручек; statePath: 'state'
    // jobline: элемент строки статуса (или null); onState: панель домена
    constructor({ base, statePath = 'state', pollMs = 1000, jobline, onState }) {
      this.base = String(base || '').replace(/\/$/, '');
      this.stateUrl = this.base + '/' + statePath;
      this.pollMs = pollMs;
      this.jobline = jobline || null;
      this.onState = onState || null;
      this.waitJobs = new Map(); // jobId → handler(job)
      this.pausedNow = false;
      this._timer = 0;
      this._stopped = false;
    }

    run() {
      this._stopped = false;
      this._poll();
      return this;
    }

    stop() {
      this._stopped = true;
      clearTimeout(this._timer);
    }

    get(path) { return getJson(`${this.base}/${path}`); }
    post(path, body) { return postJson(`${this.base}/${path}`, body); }

    // джоба: POST → промис резолвится, когда поллинг увидит done/error
    // (результат уже в state.jobs)
    startJob(path, body, onDone) {
      return this.post(path, body).then(({ jobId }) => this.awaitJob(jobId, onDone));
    }

    // джоба уже запущена (например, bulk-действием таблицы): только ждём
    awaitJob(jobId, onDone) {
      return new Promise((resolve) => {
        this.waitJobs.set(jobId, (job) => {
          try { onDone(job); } finally { resolve(job); }
        });
        this.showJob('запущено…');
      });
    }

    // loader на кнопках: от клика до фактического завершения задачи
    async withLoading(buttons, fn) {
      const list = Array.isArray(buttons) ? buttons : [buttons];
      list.forEach((b) => { b.disabled = true; b.classList.add('loading'); });
      try {
        await fn();
      } catch (e) {
        this.showJob(`ошибка: ${e.message || e}`, 'bad');
      } finally {
        list.forEach((b) => { b.classList.remove('loading'); b.disabled = false; });
      }
    }

    showJob(text, cls) {
      if (!this.jobline) return;
      this.jobline.textContent = text;
      this.jobline.classList.toggle('hidden', !text);
      this.jobline.classList.toggle('is-bad', cls === 'bad');
    }

    _poll() {
      clearTimeout(this._timer);
      getJson(this.stateUrl)
        .then((s) => {
          if (this._stopped) return;
          this.pausedNow = !!s.paused;
          if (this.onState) {
            try { this.onState(s); } catch (e) { this.showJob(`ошибка рендера: ${e.message || e}`, 'bad'); }
          }
          // завершённые джобы, которых ждём — результат уже в state
          for (const j of s.jobs || []) {
            if (this.waitJobs.has(j.id) && (j.status === 'done' || j.status === 'error')) {
              const handler = this.waitJobs.get(j.id);
              this.waitJobs.delete(j.id);
              try { handler(j); } catch (e) { this.showJob(`ошибка рендера: ${e.message || e}`, 'bad'); }
            }
          }
        })
        .catch((e) => {
          if (!this._stopped) this.showJob(`ошибка поллинга: ${e.message || e}`, 'bad');
        })
        .finally(() => {
          if (!this._stopped) this._timer = setTimeout(() => this._poll(), this.pollMs);
        });
    }
  }

  window.VeshaUI.JobConsole = JobConsole;
})();
