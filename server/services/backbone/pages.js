// Спеки страниц костяка (docs/ui-components.md §5): служебный экран = запись здесь.
// Открывается /experiments/backbone/?page=<имя> (boot@1) или /c/page.html?spec=/api/backbone/c/pages/<имя>.
const { Pages } = require('../../components/pages');

module.exports = Pages({
  'main': {
    title: 'Костяк · доска заявок',
    subtitle: 'Шаг 1 MVP: заявка вручную, перенос по колонкам, конструктор колонок со смысловыми типами — и каждое действие в журнале',
    blocks: [
      { kind: 'kanban@1', src: '/api/backbone/c/board', poll: 4000, title: 'Доска демо-магазина' },
      { kind: 'table@1', src: '/api/backbone/c/receipts', poll: 6000, title: 'Квитанции клиентам — витрина: /backbone/' },
      { kind: 'table@1', src: '/api/backbone/c/journal', poll: 4000, title: 'Журнал событий' },
      { kind: 'table@1', src: '/api/backbone/c/catalog', title: 'Каталог — фикстура на 300 позиций' },
    ],
  },
  'draft': {
    title: 'Костяк · черновики счетов',
    subtitle: 'Шаг 2 MVP: заявка → строки (правила, остаток — модель со сверкой цифр) → позиции каталога с уверенностью → остаток и упаковка → черновик. Правка менеджера рождает синоним.',
    blocks: [
      { kind: 'table@1', src: '/api/backbone/c/drafts', poll: 4000, title: 'Заявки: разбор, выгрузка в 1С, счёт' },
      { kind: 'table@1', src: '/api/backbone/c/lines', poll: 4000, title: 'Строки черновиков — принять, заменить позицию, исправить количество' },
      { kind: 'table@1', src: '/api/backbone/c/synonyms', poll: 6000, title: 'Синонимы магазина' },
      { kind: 'table@1', src: '/api/backbone/c/journal', poll: 4000, title: 'Журнал событий' },
    ],
  },
  'measures': {
    title: 'Костяк · замеры',
    subtitle: 'Шаг 3 MVP: все метрики — из журнала событий. Тень (до) — черновик скрыт, к заявке прикладывают счёт из 1С; помощь (после) — менеджер работает с черновиком. Помощь включается решением с мерой: точность от 0,8.',
    blocks: [
      { kind: 'table@1', src: '/api/backbone/c/summary', poll: 8000, title: 'До и после' },
      { kind: 'table@1', src: '/api/backbone/c/weeks', poll: 8000, title: 'По неделям' },
      { kind: 'table@1', src: '/api/backbone/c/journal', poll: 8000, title: 'Журнал событий' },
    ],
  },
});
