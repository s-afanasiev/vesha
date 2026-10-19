// Каркас компонентных экземпляров (docs/ui-components.md §1): домен объявляет
// Components({ '<id>': Table({...}) }) в своей точке сборки, каркас монтирует
// контрактные эндпоинты под /api/<namespace>/c/<id>. Реестр видов (П8): новый
// вид подключается сюда одной строкой и не меняет агрегатор.

const express = require('express');
const table = require('./table');
const kanban = require('./kanban');
const tree = require('./tree');
const stages = require('./stages');
const switchKind = require('./switch');
const extract = require('./extract');

const KINDS = { table, kanban, tree, stages, switch: switchKind, extract };

function Components(declarations) {
  const router = express.Router();
  for (const [id, decl] of Object.entries(declarations || {})) {
    const kind = KINDS[decl.kind];
    if (!kind) throw new Error(`Неизвестный вид компонента: ${decl.kind}`);
    router.use(`/${id}`, kind.router(decl));
  }
  return router;
}

module.exports = { Components };
