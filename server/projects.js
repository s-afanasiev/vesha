// Реестр проектов и профили монтирования.
//
// Истина состава — projects/<id>/project.json: что за проект, какого он рода
// (experiment | showcase | client), какие API-маршруты и какая статика.
// main.js больше не перечисляет маршруты руками: он просит у этого модуля
// смонтировать профиль.
//
//   PROFILE=full          всё, как исторически (по умолчанию)
//   PROFILE=lab           только эксперименты
//   PROFILE=showcase      только витринные проекты
//   PROFILE=client:<id>   только проекты этого заказчика
//
// Платформенные маршруты (вход, шлюз моделей, каталог) не принадлежат ни одному
// проекту и перечислены здесь. Профиль решает, какие из них нужны.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PROJECTS_DIR = path.join(ROOT, 'projects');

const KINDS = ['experiment', 'showcase', 'client'];

const PLATFORM = {
  auth: { mount: '/api/auth', module: 'server/routes/auth' },
  llm: { mount: '/api/llm', module: 'server/routes/llm' },
  catalog: { mount: '/api/experiments', module: 'server/routes/experiments' },
};

const PROFILES = {
  full: { kinds: KINDS, platform: ['auth', 'llm', 'catalog'] },
  lab: { kinds: ['experiment'], platform: ['auth', 'llm', 'catalog'] },
  showcase: { kinds: ['showcase'], platform: ['auth', 'llm'] },
};

function fail(message) {
  throw new Error(`projects: ${message}`);
}

// 'client:acme' → { name: 'client', client: 'acme', kinds: ['client'], platform: [...] }
function parseProfile(profile) {
  const raw = String(profile || 'full').trim();
  if (raw.startsWith('client:')) {
    const client = raw.slice('client:'.length).trim();
    if (!client) fail('пустой client:<id>');
    return { name: 'client', client, kinds: ['client'], platform: ['auth', 'llm'] };
  }
  const known = PROFILES[raw];
  if (!known) fail(`неизвестный профиль «${raw}», есть: ${Object.keys(PROFILES).join(', ')}, client:<id>`);
  return { name: raw, ...known };
}

function validate(project, dir) {
  const where = `projects/${dir}/project.json`;
  if (!project || typeof project !== 'object') fail(`${where}: не объект`);
  if (project.id !== dir) fail(`${where}: id «${project.id}» не совпадает с папкой`);
  if (!KINDS.includes(project.kind)) fail(`${where}: kind «${project.kind}», нужно ${KINDS.join(' | ')}`);
  if (!Number.isInteger(project.order)) fail(`${where}: order — целое число`);
  if (!Array.isArray(project.routes)) fail(`${where}: routes — массив`);
  if (!Array.isArray(project.tech || [])) fail(`${where}: tech — массив`);

  for (const route of project.routes) {
    if (!route || typeof route.mount !== 'string' || !route.mount.startsWith('/')) {
      fail(`${where}: у маршрута mount должен начинаться с /`);
    }
    if (typeof route.module !== 'string' || !route.module) fail(`${where}: у маршрута нет module`);
    const file = path.resolve(ROOT, route.module);
    if (!file.startsWith(`${ROOT}${path.sep}`)) fail(`${where}: module «${route.module}» вне репозитория`);
  }

  if (project.kind === 'client' && !project.client) {
    fail(`${where}: kind=client, но не указан client`);
  }
  return project;
}

// Все манифесты, в порядке order, затем id. Читается один раз за процесс.
let cache = null;
function load({ fresh = false } = {}) {
  if (cache && !fresh) return cache;
  if (!fs.existsSync(PROJECTS_DIR)) fail(`нет папки ${PROJECTS_DIR}`);

  const projects = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const file = path.join(PROJECTS_DIR, d.name, 'project.json');
      if (!fs.existsSync(file)) fail(`projects/${d.name}: нет project.json`);
      return validate(JSON.parse(fs.readFileSync(file, 'utf8')), d.name);
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const ids = new Set();
  const mounts = new Map();
  for (const p of projects) {
    if (ids.has(p.id)) fail(`повтор id «${p.id}»`);
    ids.add(p.id);
    for (const r of p.routes) {
      if (mounts.has(r.mount)) fail(`маршрут ${r.mount} занят: ${mounts.get(r.mount)} и ${p.id}`);
      mounts.set(r.mount, p.id);
    }
  }
  for (const r of Object.values(PLATFORM)) {
    if (mounts.has(r.mount)) fail(`платформенный маршрут ${r.mount} занят проектом ${mounts.get(r.mount)}`);
  }

  cache = projects;
  return projects;
}

// Чистая фильтрация: профиль × манифесты. Вынесена отдельно, чтобы тесты
// не зависели от файлов на диске.
function select(projects, profile) {
  const p = parseProfile(profile);
  const picked = projects
    .filter((project) => p.kinds.includes(project.kind))
    .filter((project) => p.name !== 'client' || project.client === p.client)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return picked;
}

function hasCatalog(profile) {
  return parseProfile(profile).platform.includes('catalog');
}

// Монтирует платформу и выбранные проекты. Возвращает сводку — её пишет main.js
// в лог и проверяют тесты.
function mount(app, { profile = 'full', projects = load() } = {}) {
  const parsed = parseProfile(profile);
  const selected = select(projects, profile);
  const mounts = [];

  for (const key of parsed.platform) {
    const route = PLATFORM[key];
    app.use(route.mount, require(path.join(ROOT, route.module)));
    mounts.push({ ...route, owner: 'platform' });
  }
  for (const project of selected) {
    for (const route of project.routes) {
      app.use(route.mount, require(path.join(ROOT, route.module)));
      mounts.push({ ...route, owner: project.id });
    }
  }

  return { profile: parsed, projects: selected, mounts };
}

module.exports = {
  ROOT,
  PROJECTS_DIR,
  KINDS,
  PLATFORM,
  PROFILES,
  parseProfile,
  load,
  select,
  hasCatalog,
  mount,
};
