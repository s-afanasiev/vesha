// Шаблоны доски по нишам (docs/backbone-architecture.md §6.2) — данные, не код:
// колонки по умолчанию для нового магазина. Владелец дальше правит доску
// конструктором; тип колонки — смысл (окно статуса и замеры), название — его вкус.

const TEMPLATES = {
  hardware: [
    { id: 'new', title: 'Новая заявка', type: 'inbox', color: '#f0a868' },
    { id: 'parse', title: 'Разбор', type: 'working', color: '#e8c95c' },
    { id: 'ask', title: 'Вопрос клиенту', type: 'waiting_client', color: '#7fb3e0' },
    { id: 'invoice', title: 'Счёт отправлен', type: 'waiting_client', color: '#9fc4e8' },
    { id: 'paid', title: 'Оплачен, собираем', type: 'working', color: '#b39ddb' },
    { id: 'issued', title: 'Выдан', type: 'done', color: '#86c28b' },
    { id: 'refused', title: 'Отказ', type: 'refused', color: '#e08a8a' },
  ],
  metalworking: [
    { id: 'new', title: 'Заявка', type: 'inbox', color: '#f0a868' },
    { id: 'quote', title: 'Расчёт', type: 'working', color: '#e8c95c' },
    { id: 'approval', title: 'Согласование', type: 'waiting_client', color: '#7fb3e0' },
    { id: 'production', title: 'В работе', type: 'working', color: '#b39ddb' },
    { id: 'ready', title: 'Готово', type: 'waiting_client', color: '#9fc4e8' },
    { id: 'issued', title: 'Выдано', type: 'done', color: '#86c28b' },
    { id: 'refused', title: 'Отказ', type: 'refused', color: '#e08a8a' },
  ],
};

// Ниша словами — для формы магазина в кабинете.
const NICHE_NAMES = { hardware: 'Крепёж и сантехника', metalworking: 'Металлообработка' };

function templateOf(niche) {
  const columns = TEMPLATES[niche];
  if (!columns) throw new Error(`Нет шаблона доски для ниши: ${niche}`);
  return columns.map((c) => ({ ...c, limit: null }));
}

module.exports = { TEMPLATES, NICHE_NAMES, templateOf };
