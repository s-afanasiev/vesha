// Костяк MVP (backbone): тонкий транспорт (П9). Всё API — компонентные экземпляры
// и спека страницы; сценарии — в BackboneDesk. Заявки несут контакты клиентов,
// поэтому целиком за requireAdmin: скрытие плитки — удобство, граница — здесь.

const express = require('express');
const experiments = require('../services/experiments');

const router = express.Router();

router.use(experiments.requireAdmin);
router.use('/c/pages', require('../services/backbone/pages'));
router.use('/c', require('../services/backbone/components'));
router.use('/files', require('../services/backbone/files'));

module.exports = router;
