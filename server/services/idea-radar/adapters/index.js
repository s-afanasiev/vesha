// Реестр адаптеров: значение idea_radar_sources.adapter → реализация контракта
// «pages(source, ctx) → асинхронный поток пачек публикаций, от новых к старым».
module.exports = {
  rss: require('./rss'),
  pravo: require('./pravo'),
  trudvsem: require('./trudvsem'),
};
