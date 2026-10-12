// Корпус ниши на диске — одна раскладка для сбора и разбора (П41):
//   <dataDir>/niches/<slug>/ orgs.json · audit-cards.json · audit-sites.json ·
//                            reviews.ndjson · marks.jsonl · meta.json
// Сбор пишет во временную папку рядом и подменяет корпус только целиком и только
// при успехе: остановленный или упавший сбор прежний корпус не портит (П40 —
// преобразование сохраняет то, что было, пока новое не готово).

const fs = require('node:fs/promises');
const path = require('node:path');

class Corpus {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  dirOf(slug) {
    return path.join(this.dataDir, 'niches', slug);
  }

  writer(slug) {
    return new CorpusWriter(this.dirOf(slug));
  }

  // Что лежит на диске: дата сбора и счётчики из meta.json; корпуса нет — null.
  // Старый meta.json опытных скриптов знает только дату.
  async info(slug) {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(this.dirOf(slug), 'meta.json'), 'utf8'));
      return { collectedAt: meta.collectedAt || meta.at || null, counts: meta.counts || null };
    } catch (err) {
      if (err.code === 'ENOENT') {
        const hasOrgs = await fs.access(path.join(this.dirOf(slug), 'orgs.json')).then(() => true, () => false);
        return hasOrgs ? { collectedAt: null, counts: null } : null;
      }
      throw err;
    }
  }
}

class CorpusWriter {
  constructor(dir) {
    this.dir = dir;
    this.tmp = `${dir}.collecting`;
  }

  async begin() {
    await fs.rm(this.tmp, { recursive: true, force: true });
    await fs.mkdir(this.tmp, { recursive: true });
  }

  json(name, value) {
    return fs.writeFile(path.join(this.tmp, name), JSON.stringify(value, null, 1));
  }

  ndjson(name, records) {
    return fs.writeFile(path.join(this.tmp, name), records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
  }

  // Подмена целиком: старый корпус уходит в .prev, новый встаёт на место, .prev удаляется.
  async commit() {
    const prev = `${this.dir}.prev`;
    await fs.rm(prev, { recursive: true, force: true });
    const hadOld = await fs.access(this.dir).then(() => true, () => false);
    if (hadOld) await fs.rename(this.dir, prev);
    await fs.rename(this.tmp, this.dir);
    if (hadOld) await fs.rm(prev, { recursive: true, force: true });
  }

  abandon() {
    return fs.rm(this.tmp, { recursive: true, force: true });
  }
}

module.exports = { Corpus, CorpusWriter };
