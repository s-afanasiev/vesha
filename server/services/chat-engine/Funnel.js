// Воронка диалогов — правило (docs/oop-principles.md П14): отвечает на вопросы
// про этапы, хранением не занимается. Этапы и их цвета читает UI: цвет — часть
// правила (пастельная рамка колонки канбана), а не оформление клиента.

const DEFAULT_STAGES = [
  { id: 'new', title: 'Новое', color: '#f0a868' },
  { id: 'in_work', title: 'В работе', color: '#e8c95c' },
  { id: 'offer', title: 'Предложение отправлено', color: '#7fb3e0' },
  { id: 'negotiation', title: 'Переговоры', color: '#b39ddb' },
  { id: 'won', title: 'Успех', color: '#86c28b' },
  { id: 'lost', title: 'Отказ', color: '#e08a8a' },
];

class Funnel {
  constructor(options = {}) {
    this.stages = options.stages || DEFAULT_STAGES;
  }

  isKnown(stageId) {
    return this.stages.some((s) => s.id === stageId);
  }

  labelOf(stageId) {
    const stage = this.stages.find((s) => s.id === stageId);
    return stage ? stage.title : stageId;
  }

  snapshot() {
    return this.stages.map((s) => ({ ...s }));
  }
}

module.exports = { Funnel, DEFAULT_STAGES };
