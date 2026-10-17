// Спеки страниц костяка (docs/ui-components.md §5): служебный экран = запись здесь.
// Экраны магазина открываются /experiments/backbone/?shop=<slug>&page=<имя> (boot@1,
// спека — /api/backbone/s/<slug>/c/pages/<имя>); кабинет — ?page=shops
// (/api/backbone/c/pages/shops). Спека магазина — те же блоки с его адресом в src.
const { Pages } = require('../../components/pages');

const shopPages = (c) => ({
  'main': {
    title: 'Костяк · доска заявок',
    subtitle: 'Шаг 1 MVP: заявка вручную, перенос по колонкам, конструктор колонок со смысловыми типами — и каждое действие в журнале',
    blocks: [
      { kind: 'kanban@1', src: `${c}/board`, poll: 4000, title: 'Доска магазина' },
      { kind: 'table@1', src: `${c}/receipts`, poll: 6000, title: 'Квитанции клиентам — с витрины /backbone/' },
      { kind: 'table@1', src: `${c}/journal`, poll: 4000, title: 'Журнал событий' },
    ],
  },
  'draft': {
    title: 'Костяк · черновики счетов',
    subtitle: 'Шаг 2 MVP: заявка → строки (правила, остаток — модель со сверкой цифр) → позиции каталога с уверенностью → остаток и упаковка → черновик. Правка менеджера рождает синоним.',
    blocks: [
      { kind: 'table@1', src: `${c}/drafts`, poll: 4000, title: 'Заявки: разбор, выгрузка в 1С, счёт' },
      { kind: 'table@1', src: `${c}/lines`, poll: 4000, title: 'Строки черновиков — принять, заменить позицию, исправить количество' },
      { kind: 'table@1', src: `${c}/synonyms`, poll: 6000, title: 'Синонимы магазина' },
      { kind: 'table@1', src: `${c}/journal`, poll: 4000, title: 'Журнал событий' },
    ],
  },
  'measures': {
    title: 'Костяк · замеры',
    subtitle: 'Шаг 3 MVP: все метрики — из журнала событий. Тень (до) — черновик скрыт, к заявке прикладывают счёт из 1С; помощь (после) — менеджер работает с черновиком. Помощь включается решением с мерой: точность от 0,8.',
    blocks: [
      { kind: 'table@1', src: `${c}/summary`, poll: 8000, title: 'До и после' },
      { kind: 'table@1', src: `${c}/weeks`, poll: 8000, title: 'По неделям' },
      { kind: 'table@1', src: `${c}/journal`, poll: 8000, title: 'Журнал событий' },
    ],
  },
  'catalog': {
    title: 'Костяк · каталог магазина',
    subtitle: 'Выгрузка 1С, МойСклад или прайс в xlsx: «Загрузить файл выгрузки» → проверить колонки («Указать колонку») → «Загрузить каталог». Каталог подменяется целиком, только если выгрузка прочитана; что не загрузилось — списком.',
    blocks: [
      { kind: 'table@1', src: `${c}/catalog-fields`, poll: 6000, title: 'Сопоставление колонок' },
      { kind: 'table@1', src: `${c}/catalog-columns`, poll: 6000, title: 'Колонки файла' },
      { kind: 'table@1', src: `${c}/catalog-rejects`, poll: 6000, title: 'Не загружено — последняя попытка' },
      { kind: 'table@1', src: `${c}/catalog-loads`, poll: 6000, title: 'Загрузки' },
      { kind: 'table@1', src: `${c}/catalog`, poll: 10000, title: 'Каталог сейчас' },
    ],
  },
  'assistant': {
    title: 'Костяк · ассистент',
    subtitle: 'Шаг 5 MVP: виджет на витрине /backbone/. Наличие и цену, статус своей заявки и часы работы ассистент отвечает сам — из каталога и журнала магазина; список из разговора — заявка тем же ключом «контакт + содержимое», что с сайта. Остальное ждёт менеджера: «Предложить ответ» — черновик модели без контактов клиента.',
    blocks: [
      { kind: 'table@1', src: `${c}/chats`, poll: 4000, title: 'Разговоры' },
      { kind: 'table@1', src: `${c}/chat-messages`, poll: 4000, title: 'Сообщения — черновик отправить, править или отклонить' },
      { kind: 'table@1', src: `${c}/journal`, poll: 6000, title: 'Журнал событий' },
    ],
  },
});

const built = new Map();
function pagesOf(slug) {
  if (!built.has(slug)) built.set(slug, Pages(shopPages(`/api/backbone/s/${encodeURIComponent(slug)}/c`)));
  return built.get(slug);
}

const cabinetPages = Pages({
  'shops': {
    title: 'Костяк · магазины',
    subtitle: 'Магазин заводится здесь, без правки кода: адрес, название, ниша, часы, почта для квитанций. Новый магазин — в тени: 14 дней база «до». Дальше — экран «Каталог» магазина. Сотрудник магазина — «Добавить сотрудника» с его почтой: он регистрируется с ней сам и видит только свой магазин.',
    blocks: [
      { kind: 'table@1', src: '/api/backbone/c/shops', poll: 8000, title: 'Магазины' },
      { kind: 'table@1', src: '/api/backbone/c/staff', poll: 8000, title: 'Сотрудники магазинов — кабинет только своего магазина' },
    ],
  },
});

module.exports = { pagesOf, cabinetPages, SHOP_PAGES: Object.keys(shopPages('')) };
