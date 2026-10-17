// Граница сборки магазина (scripts/build-shop.mjs, docs/backbone-handover.md): сборка
// во временную папку; require-граф от shop.js — только файлы сборки из манифеста, ни
// одного эксперимента Vesha; пакеты — ровно package.json магазина тех же версий, что
// в корне; миграции и SQL кода — только таблицы сборки; собранное приложение
// поднимается и отдаёт витрину, кабинет и UI-кит, а адреса Vesha — 404.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { builtinModules } = require('node:module');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SHOP_HOME = 'metiz-test';
let MANIFEST;
let tmp;
let out;

before(async () => {
  const build = await import('../scripts/build-shop.mjs');
  MANIFEST = build.MANIFEST;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vesha-shop-'));
  out = path.join(tmp, '.apps', 'shop');               // папка с точкой в пути — как .claude/worktrees
  build.buildShop({ out });
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

const rel = (file) => path.relative(out, file).split(path.sep).join('/');
const packageOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
const isBuiltin = (spec) => spec.startsWith('node:') || builtinModules.includes(spec);

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? filesUnder(full) : [full];
  });
}

// Обход require: локальный путь разрешается только внутри сборки (абсолютный путь
// в папке сборки — node_modules и репозиторий не участвуют); пакеты — по именам.
function requireGraph(roots) {
  const files = new Set();
  const missing = [];
  const packages = new Map();
  const visit = (file) => {
    if (files.has(file)) return;
    files.add(file);
    if (!file.endsWith('.js')) return;
    const src = fs.readFileSync(file, 'utf8');
    for (const [, spec] of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (spec.startsWith('.')) {
        let target;
        try {
          target = require.resolve(path.resolve(path.dirname(file), spec));
        } catch {
          missing.push(`${rel(file)} → ${spec}`);
          continue;
        }
        visit(target);
      } else if (!isBuiltin(spec)) {
        const name = packageOf(spec);
        if (!packages.has(name)) packages.set(name, new Set());
        packages.get(name).add(rel(file));
      }
    }
  };
  for (const r of roots) visit(r);
  return { files: [...files].map(rel).sort(), missing, packages };
}

const inManifest = (file) => MANIFEST.files.includes(file) || MANIFEST.dirs.some((d) => file.startsWith(`${d}/`));

test('сборка магазина: require-граф от shop.js — файлы сборки из манифеста, без других экспериментов', () => {
  const graph = requireGraph([path.join(out, MANIFEST.entry)]);
  assert.deepEqual(graph.missing, [], 'локальный require ведёт за пределы сборки');
  assert.ok(graph.files.includes('server/routes/backbone.js') && graph.files.includes('server/routes/auth.js'));
  assert.deepEqual(graph.files.filter((f) => !inManifest(f)), [], 'файл не из манифеста');
  assert.deepEqual(
    graph.files.filter((f) => f.startsWith('server/services/chat-engine/')),
    ['ChatDesk', 'DialogueRepository', 'Funnel', 'ReplySuggester'].map((n) => `server/services/chat-engine/${n}.js`),
    'от chat-engine — только ядро из четырёх классов',
  );
  // маршруты и сервисы других экспериментов Vesha в сборку не попали вовсе
  const others = fs.readdirSync(path.join(ROOT, 'server', 'routes')).filter((f) => !['auth.js', 'backbone.js', 'backbonePublic.js'].includes(f));
  for (const f of others) assert.ok(!fs.existsSync(path.join(out, 'server', 'routes', f)), `маршрут ${f} в сборке`);
  for (const d of ['automation-leads', 'idea-radar', 'pain-radar', 'super-notes', 'radar']) {
    assert.ok(!fs.existsSync(path.join(out, 'server', 'services', d)), `эксперимент ${d} в сборке`);
  }
});

test('сборка магазина: каждый файл сервера разрешает require внутри сборки, пакеты — из package.json магазина', () => {
  const roots = filesUnder(path.join(out, 'server')).filter((f) => f.endsWith('.js'));
  const graph = requireGraph([path.join(out, MANIFEST.entry), ...roots]);
  assert.deepEqual(graph.missing, []);
  const pkg = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'));
  const used = [...graph.packages.keys()].filter((n) => !MANIFEST.optional[n]).sort();
  assert.deepEqual(used, Object.keys(pkg.dependencies).sort(), 'зависимости магазина — ровно те, что требует код');
});

test('сборка магазина: package.json и package-lock.json — подмножество корневых, тех же версий', () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const rootLock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(out, 'package-lock.json'), 'utf8'));
  for (const [n, v] of Object.entries(pkg.dependencies)) assert.equal(v, rootPkg.dependencies[n], n);
  for (const n of ['sharp', 'replicate', '@playwright/mcp', '@modelcontextprotocol/sdk', 'turndown', 'marked', 'sanitize-html']) {
    assert.ok(!pkg.dependencies[n] && !lock.packages[`node_modules/${n}`], `${n} не входит`);
  }
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies, 'корень lock совпадает с package.json');
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key) assert.deepEqual(entry, rootLock.packages[key], key);
  }
  for (const n of Object.keys(pkg.dependencies)) assert.ok(lock.packages[`node_modules/${n}`], `${n} в lock`);
});

test('сборка магазина: миграции — 001 только вход, без 021; SQL кода — только таблицы сборки', () => {
  const dir = path.join(out, 'db', 'migrations');
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, [MANIFEST.init.to, ...MANIFEST.migrations].sort());
  assert.ok(!names.some((n) => n.startsWith('021_')), '021 (automation-leads) не входит');
  const sql = Object.fromEntries(names.map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')]));
  const created = (text) => [...text.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created(sql[MANIFEST.init.to]), MANIFEST.init.tables);
  const tables = new Set(['schema_migrations', ...Object.values(sql).flatMap(created)]);
  for (const [n, text] of Object.entries(sql)) {
    for (const [, t] of text.matchAll(/(?:ALTER TABLE|REFERENCES|INSERT INTO|UPDATE|ON) (\w+)/g)) {
      if (!/^[A-Z]+$/.test(t)) assert.ok(tables.has(t), `${n}: таблица ${t} не из сборки`);
    }
  }
  const code = filesUnder(path.join(out, 'server')).filter((f) => f.endsWith('.js'));
  for (const file of code) {
    const src = fs.readFileSync(file, 'utf8');
    for (const [, t] of src.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)\b/g)) {
      assert.ok(tables.has(t), `${rel(file)}: таблица ${t} не из миграций сборки`);
    }
  }
});

test('сборка магазина: статика — без ссылок на эксперименты, адреса страниц ведут в сборку; .env.example — ключи config', () => {
  const pub = path.join(out, 'public');
  for (const file of filesUnder(pub)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('/experiments/'), `${rel(file)}: ссылка на каталог экспериментов`);
    const shown = text.match(/>[^<>\n]*(?:\bVesha\b|[Ээ]ксперимент)[^<>\n]*</);  // текст между тегами — то, что видит человек
    assert.equal(shown, null, `${rel(file)}: заказчику видно ${shown}`);
  }
  for (const file of filesUnder(pub).filter((f) => f.endsWith('.html'))) {
    for (const [, url] of fs.readFileSync(file, 'utf8').matchAll(/(?:src|href)="(\/[^"$?#]*)/g)) {
      const target = path.join(pub, url.endsWith('/') ? `${url}index.html` : url);
      assert.ok(fs.existsSync(target), `${rel(file)}: ${url} нет в сборке`);
    }
  }
  const configSrc = fs.readFileSync(path.join(out, 'server', 'config.js'), 'utf8');
  const keys = [...fs.readFileSync(path.join(out, '.env.example'), 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
  assert.ok(keys.includes('SHOP_HOME') && keys.includes('DATABASE_URL'));
  for (const k of keys) assert.ok(configSrc.includes(`'${k}'`) || configSrc.includes(`process.env.${k}`), `${k} не читает config`);
  assert.ok(fs.existsSync(path.join(out, 'README.md')) && fs.existsSync(path.join(out, 'build.json')));
});

test('сборка магазина: собранное приложение поднимается — витрина, кабинет, UI-кит; адресов Vesha нет', () => {
  // пакеты — из node_modules корня через NODE_PATH: в сборке их нет, а граф пакетов проверен выше
  const probe = `
    const { app } = require('./shop.js');
    const server = app.listen(0, '127.0.0.1', async () => {
      const base = 'http://127.0.0.1:' + server.address().port;
      const out = {};
      for (const p of ${JSON.stringify(['/', '/backbone/', '/backbone/privacy.html', '/cabinet/', '/cabinet', '/c/boot.js', '/style.css', '/theme.js', '/auth.js',
    '/experiments/', '/experiments/backbone/', '/c/page.html', '/index.html', '/README.md', '/package.json', '/server/config.js'])}) {
        const r = await fetch(base + p, { redirect: 'manual' });
        const body = await r.text();
        out[p] = { status: r.status, location: r.headers.get('location'), body };
      }
      process.stdout.write('PROBE' + JSON.stringify(out));       // dotenv пишет в stdout свою строку
      process.exit(0);
    });`;
  const env = { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules'), NODE_OPTIONS: '', SHOP_HOME };
  const stdout = execFileSync(process.execPath, ['-e', probe], { cwd: out, env, encoding: 'utf8', timeout: 30_000 });
  const res = JSON.parse(stdout.slice(stdout.indexOf('PROBE{') + 'PROBE'.length));
  assert.equal(res['/'].status, 302);
  assert.equal(res['/'].location, `/backbone/?shop=${SHOP_HOME}`);
  assert.equal(res['/backbone/'].status, 200);
  assert.match(res['/backbone/'].body, /assistant\.js/);
  assert.equal(res['/backbone/privacy.html'].status, 200);
  assert.equal(res['/cabinet/'].status, 200);
  assert.match(res['/cabinet/'].body, /<title>Кабинет магазина<\/title>/);
  assert.doesNotMatch(res['/cabinet/'].body, /Эксперименты/);
  assert.ok([301, 302].includes(res['/cabinet'].status) && res['/cabinet'].location === '/cabinet/');
  for (const p of ['/c/boot.js', '/style.css', '/theme.js', '/auth.js']) assert.equal(res[p].status, 200, p);
  for (const p of ['/experiments/', '/experiments/backbone/', '/c/page.html', '/index.html', '/README.md', '/package.json', '/server/config.js']) {
    assert.equal(res[p].status, 404, p);
  }
});
