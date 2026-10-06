// Каталог плиток-экспериментов. Истина состава — public/experiments/registry.json
// (что существует, title/description, части), истина доступа — experiment_tiles(_parts)
// (visibility, enabled). При старте registry upsert'ится в БД, не трогая доступ.
// Скрытие в UI — удобство; защита данных — requireAdmin на API-эндпоинтах.

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const db = require('../db');

const REGISTRY_PATH = path.join(__dirname, '..', '..', 'public', 'experiments', 'registry.json');

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

function isAdmin(user) {
  if (!user || !config.adminEmails.length) return false;
  return config.adminEmails.includes(String(user.email || '').trim().toLowerCase());
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: 'только для админа' });
  }
  next();
}

// registry.json → БД: плитки и части. Новый плиткам/частям — дефолт 'all'
// (кроме помеченных admin: true в registry); существующие настройки не трогаем.
async function syncRegistry() {
  const registry = loadRegistry();
  for (const exp of registry.experiments || []) {
    // admin: true в реестре — плитка принудительно служебная: sync каждый раз приводит
    // её visibility к 'admin' (тумблер в каталоге такие плитки не меняет).
    const adminForce = !!exp.admin;
    const adminSet = adminForce ? ", visibility = 'admin'" : '';
    const { rows } = await db.query(
      `insert into experiment_tiles (category, name, visibility)
       values ('experiments', $1, $2)
       on conflict (category, name) do update
         set updated_at = now()${adminSet}
       returning id`,
      [exp.id, adminForce ? 'admin' : 'all']
    );
    const tileId = rows[0].id;
    for (const part of exp.parts || []) {
      await db.query(
        `insert into experiment_tile_parts (tile_id, part_key, title, visibility)
         values ($1, $2, $3, $4)
         on conflict (tile_id, part_key) do update set title = excluded.title`,
        [tileId, part.key, part.title || part.key, part.admin ? 'admin' : 'all']
      );
    }
  }
}

// Каталог для текущей личности: registry × доступ из БД. title/description/href/tech
// всегда из файла (версионируются), из БД — только доступ.
async function listVisible(user) {
  const admin = isAdmin(user);
  const registry = loadRegistry();
  const byId = new Map((registry.experiments || []).map((e) => [e.id, e]));

  const tiles = (await db.query(
    `select id, category, name, visibility from experiment_tiles
     where enabled = true and category = 'experiments'`
  )).rows;

  const parts = (await db.query(
    `select p.tile_id, p.part_key, p.title, p.visibility
     from experiment_tile_parts p
     join experiment_tiles t on t.id = p.tile_id
     where p.enabled = true`
  )).rows;
  const partsByTile = new Map();
  for (const p of parts) {
    if (!partsByTile.has(p.tile_id)) partsByTile.set(p.tile_id, []);
    partsByTile.get(p.tile_id).push({ key: p.part_key, title: p.title, visibility: p.visibility });
  }

  const out = [];
  for (const t of tiles) {
    if (!admin && t.visibility !== 'all') continue;
    const exp = byId.get(t.name);
    if (!exp) continue; // запись в БД без файла — не показываем
    const tileParts = (partsByTile.get(t.id) || []).filter((p) => admin || p.visibility === 'all');
    out.push({ ...exp, visibility: t.visibility, adminLocked: !!exp.admin, parts: tileParts });
  }
  out.sort((a, b) => (registry.experiments || []).findIndex((e) => e.id === a.id) - (registry.experiments || []).findIndex((e) => e.id === b.id));
  return { admin, tiles: out };
}

async function setVisibility(category, name, visibility) {
  if (!['all', 'admin'].includes(visibility)) throw new Error('visibility: all | admin');
  const { rowCount } = await db.query(
    `update experiment_tiles set visibility = $3, updated_at = now()
     where category = $1 and name = $2`,
    [category, name, visibility]
  );
  if (!rowCount) throw new Error(`плитка не найдена: ${category}/${name}`);
  return { category, name, visibility };
}

module.exports = { loadRegistry, syncRegistry, isAdmin, requireAdmin, listVisible, setVisibility };
