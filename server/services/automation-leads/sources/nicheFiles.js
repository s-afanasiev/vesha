// Источник ниши из корпуса на диске (раскладка — corpus.js): разбор читает то,
// что положил сбор «Собрать» или опытные скрипты 11.10.2026. Корпус — снимок:
// разбор повторяется без обращения к 2ГИС.
//
// Контракт источника ниши:
//   places()          → [{ branch_id, name, address, rubrics }]   листинг ниши
//   card(branchId)    → карточка места или null
//   site(domain)      → аудит главной страницы или null (не проверяли)
//   reviews(branchId) → [{ review_id, rating, date, text, answered }]
// Разметка отзывов — отдельный контракт: marking.of(review) → { author, signals } | null.

const fs = require('node:fs/promises');
const path = require('node:path');

class NicheDataMissing extends Error {
  constructor(file) {
    super(`нет данных ниши: ${file}`);
    this.code = 'no_niche_data';
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw new NicheDataMissing(file);
    throw err;
  }
}

async function readNdjson(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (err) {
    if (err.code === 'ENOENT') throw new NicheDataMissing(file);
    throw err;
  }
}

class NicheFiles {
  constructor(dir) {
    this.dir = dir;
    this.loaded = null;
  }

  async places() {
    const { orgs } = await this._load();
    return orgs.map((o) => ({ branch_id: o.branch_id, name: o.name, address: o.address || '', rubrics: o.rubrics || [] }));
  }

  async card(branchId) {
    const { cards } = await this._load();
    const card = cards[branchId];
    return card && !card.error ? card : null;
  }

  async site(domain) {
    const { sites } = await this._load();
    return sites[domain] || null;
  }

  async reviews(branchId) {
    const { reviewsByBranch } = await this._load();
    return reviewsByBranch.get(branchId) || [];
  }

  // Файлы читаются один раз на экземпляр: один прогон — один снимок данных.
  _load() {
    if (!this.loaded) {
      this.loaded = (async () => {
        const [orgs, cards, sites, reviews] = await Promise.all([
          readJson(path.join(this.dir, 'orgs.json')),
          readJson(path.join(this.dir, 'audit-cards.json')),
          readJson(path.join(this.dir, 'audit-sites.json')).catch((err) => {
            if (err.code === 'no_niche_data') return {};
            throw err;
          }),
          readNdjson(path.join(this.dir, 'reviews.ndjson')),
        ]);
        const reviewsByBranch = new Map();
        for (const r of reviews) {
          if (!reviewsByBranch.has(r.branch_id)) reviewsByBranch.set(r.branch_id, []);
          reviewsByBranch.get(r.branch_id).push({
            review_id: r.review_id,
            rating: r.rating,
            date: String(r.date_created || '').slice(0, 10),
            text: r.text || '',
            answered: !!r.has_official_answer,
          });
        }
        return { orgs, cards, sites, reviewsByBranch };
      })();
    }
    return this.loaded;
  }
}

// Записанная разметка отзывов корпуса (marks.jsonl, справочник v2): контракт
// of(review). Не размеченный отзыв — null, а не «сбоев нет» (П38); нет файла
// разметки — все отзывы не размечены, и разбор так и скажет.
class RecordedMarking {
  constructor(file) {
    this.paths = [file];
    this.loaded = null;
  }

  async of(review) {
    const byReview = await this._load();
    return byReview.get(String(review.review_id)) || null;
  }

  _load() {
    if (!this.loaded) {
      this.loaded = (async () => {
        const byReview = new Map();
        for (const file of this.paths) {
          let batches;
          try {
            batches = await readNdjson(file);
          } catch (err) {
            if (err.code === 'no_niche_data') continue;
            throw err;
          }
          for (const batch of batches) {
            for (const r of batch.reviews || []) byReview.set(String(r.review_id), { author: r.author, signals: r.signals || [] });
          }
        }
        return byReview;
      })();
    }
    return this.loaded;
  }
}

module.exports = { NicheFiles, RecordedMarking, NicheDataMissing };
