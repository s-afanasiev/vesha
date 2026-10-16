// Файлы костяка (docs/backbone-architecture.md §6.5 п. 7): xlsx черновика для 1С.
// Тонкий транспорт (П9): решение «выгрузить» — действие таблицы и событие
// invoice_exported, здесь — только чтение файла по текущим строкам черновика.
// Монтируется в server/routes/backbone.js под /api/backbone/files (за requireAdmin).

const express = require('express');
const { backboneDesk, DEMO_SHOP } = require('./index');

const router = express.Router();

router.get('/invoice/:orderId.xlsx', async (req, res, next) => {
  try {
    const file = await backboneDesk.invoiceFile(DEMO_SHOP, req.params.orderId);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
