// Реестр адаптеров каркаса сбора: значение source.adapter → реализация контракта
// «pages(source, ctx) → асинхронный поток пачек записей, от новых к старым»
// (docs/collectors-architecture.md).
module.exports = {
  rss: require('./rss'),
  pravo: require('./pravo'),
  trudvsem: require('./trudvsem'),
};
