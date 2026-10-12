// «Кому автоматизировать» (automation-leads): тонкий транспорт (П9). Всё API —
// компонентные экземпляры и спека страницы; запуск и остановка разбора — действия
// таблицы ниш. Инструмент продаж с контактами мест — целиком за requireAdmin:
// скрытие плитки в каталоге — удобство, граница — здесь.

const express = require('express');
const experiments = require('../services/experiments');

const router = express.Router();

router.use(experiments.requireAdmin);
router.use('/c/pages', require('../services/automation-leads/pages'));
router.use('/c', require('../services/automation-leads/components'));

module.exports = router;
