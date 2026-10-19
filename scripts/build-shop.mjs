// Сборка сайта магазина dist/shop (docs/backbone-handover.md): то, что отдаём
// заказчику вместо всего Vesha. Состав — манифест ниже, а не «всё, кроме»: костяк,
// платформа (вход, шлюз моделей, каркас компонентов), ядро chat-engine из четырёх
// классов, урезанные миграции. Свой package.json и package-lock.json — подмножество
// корневых, те же версии; npm ci в сборке ставит только нужное.
// Границу сборки держит test/shop-build.test.js: require-граф от shop.js — внутри
// сборки, импортов других экспериментов нет.
// Запуск: npm run build:shop [-- --out <папка>]   (по умолчанию dist/shop)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Правка при сборке: каждая замена обязана найтись — исходник поменялся, сборка падает,
// а не выпускает заказчику текст и ссылки Vesha.
const rewrite = (pairs) => (text, file) => pairs.reduce((t, [re, to]) => {
  if (!re.test(t)) throw new Error(`${file}: нет ${re} — поправьте MANIFEST.edits`);
  return t.replace(re, to);
}, text);

// Кабинет магазина — без ссылки на каталог экспериментов и со своим заголовком.
const cabinetPage = rewrite([
  [/^[ \t]*<a class="back-link" href="\/experiments\/">[^<]*<\/a>\r?\n/m, ''],
  [/<title>[^<]*<\/title>/, '<title>Кабинет магазина</title>'],
]);

// Окно входа: в кабинет входят сотрудники магазина, а не гости каталога экспериментов.
const signInWindow = rewrite([
  [/(<div class="vesha-auth-modal__brand">)Vesha(<\/div>)/, '$1Кабинет магазина$2'],
  [/(<p class="vesha-auth-modal__subtitle">)[^<]*(<\/p>)/, '$1Почта и пароль сотрудника магазина$2'],
]);

export const MANIFEST = {
  entry: 'shop.js',
  // файлы и папки целиком — пути от корня репозитория, в сборке — те же
  files: [
    'shop.js',
    'server/config.js',
    'server/db.js',
    'server/middleware/identity.js',
    'server/routes/auth.js',
    'server/routes/backbone.js',
    'server/routes/backbonePublic.js',
    'server/services/quota.js',
    'server/services/llm.js',
    'server/services/llmGuard.js',
    'server/services/rateWindow.js',                        // «не больше N за окно»: вход, форма заявки, чат витрины
    'server/services/accounts.js',                          // учётки: админ из .env, учётка сотрудника, смена пароля
    'server/services/collectors/netGuard.js',               // адреса моделей: без частных сетей
    'server/process-tree/projection.js',                    // проекция для tree@1 каркаса
    'server/services/chat-engine/ChatDesk.js',              // ядро chat-engine — без require (§6.4)
    'server/services/chat-engine/DialogueRepository.js',
    'server/services/chat-engine/ReplySuggester.js',
    'server/services/chat-engine/Funnel.js',
    'public/style.css',
    'public/theme.js',
  ],
  dirs: [
    'server/components',
    'server/services/backbone',
    'public/backbone',
    'public/c',
  ],
  // общая страница экспериментов /c/page.html со ссылкой «← Эксперименты»: у магазина — кабинет
  skip: ['public/c/page.html'],
  // правки при сборке: тот же файл Vesha (один источник правды), текст и адрес — магазина
  edits: [
    { from: 'public/experiments/backbone/index.html', to: 'public/cabinet/index.html', edit: cabinetPage },
    { from: 'public/auth.js', to: 'public/auth.js', edit: signInWindow },
  ],
  // 001 — только вход и квота гостя, файлом со своим именем; 021 (automation-leads) не входит
  init: {
    from: '001_init.sql',
    to: '001_shop_init.sql',
    tables: ['users', 'auth_identities', 'sessions', 'guests', 'usage_quotas'],
  },
  migrations: [
    '012_chat_engine.sql',
    '018_backbone.sql',
    '019_backbone_lines.sql',
    '020_backbone_mode.sql',
    '022_backbone_site.sql',
    '023_backbone_shops_catalog.sql',
    '024_backbone_shop_notice.sql',
    '025_backbone_shop_staff.sql',
    '026_backbone_assistant.sql',
    '027_backbone_staff_invite.sql',
    '028_backbone_chat_channel.sql',
    '029_backbone_mode_off.sql',
  ],
  // пакеты — версии из корневого package.json и package-lock.json
  dependencies: [
    'bcrypt', 'cookie-parser', 'dotenv', 'express', 'fast-xml-parser',
    'google-auth-library', 'multer', 'pdf-parse', 'pg',
  ],
  // require без пакета в сборке: только за настройкой, которой у магазина нет
  optional: {
    undici: 'llm.js — прокси Gemini (GEMINI_HTTPS_PROXY); в корне Vesha пакета тоже нет',
  },
  // файлы, которых нет в Vesha: README и пример .env магазина
  extras: {
    'README.md': 'scripts/shop/README.md',
    '.env.example': 'scripts/shop/env.example',
  },
};

// Из 001_init.sql — расширение и таблицы входа; IF NOT EXISTS — сборка встаёт и на
// копию базы Vesha, где эти таблицы уже есть.
function initMigration(sql, { from, tables }) {
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.replace(/^(\s*--[^\n]*\n)+/, '').trim()).filter(Boolean);
  const target = (s) => {
    const m = s.match(/^CREATE TABLE (\w+)/i) || s.match(/^CREATE (?:UNIQUE )?INDEX \w+ ON (\w+)/i);
    return m && m[1];
  };
  const kept = statements.filter((s) => /^CREATE EXTENSION/i.test(s) || tables.includes(target(s)));
  for (const t of tables) {
    if (!kept.some((s) => target(s) === t && /^CREATE TABLE/i.test(s))) throw new Error(`${from}: нет таблицы ${t}`);
  }
  const body = kept.map((s) => s
    .replace(/^CREATE TABLE (\w+)/i, 'CREATE TABLE IF NOT EXISTS $1')
    .replace(/^CREATE (UNIQUE )?INDEX (\w+)/i, 'CREATE $1INDEX IF NOT EXISTS $2'));
  return `-- Сборка магазина (scripts/build-shop.mjs): из ${from} Vesha — только вход\n`
    + `-- и квота гостя: ${tables.join(', ')}.\n\n${body.join(';\n\n')};\n`;
}

// Подмножество package-lock.json: пакеты, достижимые от зависимостей магазина,
// с поиском по node_modules, как у Node (ближайшая папка, потом выше).
function lockOf(lock, names) {
  const all = lock.packages;
  const keep = new Map();
  const visit = (from, name, optional) => {
    for (let base = from; ; ) {
      const key = `${base ? `${base}/` : ''}node_modules/${name}`;
      if (all[key]) {
        if (!keep.has(key)) {
          keep.set(key, all[key]);
          const p = all[key];
          for (const n of Object.keys(p.dependencies || {})) visit(key, n, false);
          for (const n of Object.keys(p.optionalDependencies || {})) visit(key, n, true);
          for (const n of Object.keys(p.peerDependencies || {})) visit(key, n, true);
        }
        return;
      }
      if (!base) break;
      const i = base.lastIndexOf('/node_modules/');
      base = i < 0 ? '' : base.slice(0, i);
    }
    if (!optional) throw new Error(`package-lock.json: нет ${name} (нужен ${from || 'магазину'})`);
  };
  for (const n of names) visit('', n, false);
  return Object.fromEntries([...keep].sort(([a], [b]) => a.localeCompare(b)));
}

function walkDir(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    return d.isDirectory() ? walkDir(rel) : [rel];
  });
}

function commitOf() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '';
    return dirty ? `${sha}+правки` : sha;
  } catch {
    return null;                                            // архив без .git — коммит неизвестен
  }
}

// Папка сборки чистится целиком: только пустая или прежняя сборка (с build.json).
function prepare(out) {
  const rel = path.relative(out, ROOT);
  if (!rel || !rel.startsWith('..')) throw new Error(`сборка внутрь корня репозитория или выше него: ${out}`);
  if (fs.existsSync(out) && fs.readdirSync(out).length && !fs.existsSync(path.join(out, 'build.json'))) {
    throw new Error(`${out} — не пустая и не сборка магазина (нет build.json)`);
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
}

export function buildShop({ out = path.join(ROOT, 'dist', 'shop'), manifest = MANIFEST } = {}) {
  out = path.resolve(out);
  prepare(out);
  const written = [];
  const put = (to, data) => {
    const file = path.join(out, to);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    written.push(to);
  };
  const read = (rel, enc) => fs.readFileSync(path.join(ROOT, rel), enc);

  const code = [...manifest.files, ...manifest.dirs.flatMap(walkDir)].filter((f) => !manifest.skip.includes(f));
  for (const f of code) put(f, read(f));
  for (const e of manifest.edits) put(e.to, e.edit(read(e.from, 'utf8'), e.from));

  const migrations = 'db/migrations';
  put(`${migrations}/${manifest.init.to}`, initMigration(read(`${migrations}/${manifest.init.from}`, 'utf8'), manifest.init));
  for (const m of manifest.migrations) put(`${migrations}/${m}`, read(`${migrations}/${m}`));

  const pkg = JSON.parse(read('package.json', 'utf8'));
  const dependencies = Object.fromEntries(manifest.dependencies.map((n) => {
    if (!pkg.dependencies[n]) throw new Error(`package.json: нет зависимости ${n}`);
    return [n, pkg.dependencies[n]];
  }));
  const shopPkg = {
    name: 'vesha-shop',
    version: pkg.version,
    private: true,
    description: 'Сайт магазина: витрина, заявки, кабинет, ассистент',
    main: manifest.entry,
    scripts: { start: `node ${manifest.entry}` },
    engines: pkg.engines,
    dependencies,
  };
  put('package.json', `${JSON.stringify(shopPkg, null, 2)}\n`);
  const lock = JSON.parse(read('package-lock.json', 'utf8'));
  const { name, version, engines } = shopPkg;
  put('package-lock.json', `${JSON.stringify({
    name, version, lockfileVersion: lock.lockfileVersion, requires: true,
    packages: { '': { name, version, dependencies, engines }, ...lockOf(lock, manifest.dependencies) },
  }, null, 2)}\n`);

  for (const [to, from] of Object.entries(manifest.extras)) put(to, read(from));
  put('build.json', `${JSON.stringify({ commit: commitOf(), builtAt: new Date().toISOString() }, null, 2)}\n`);
  return { out, files: written };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const { out, files } = buildShop(i > 0 ? { out: process.argv[i + 1] } : {});
  console.log(`dist: ${out} — файлов ${files.length}`);
  console.log('дальше: cd в папку сборки, .env из .env.example, npm ci --omit=dev, npm start');
}
