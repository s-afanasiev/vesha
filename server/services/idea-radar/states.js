// Единый алфавит состояний опроса (П10: сущность — именованные состояния и переходы).
// Итог записывается в idea_radar_polls и ограничен CHECK в миграции 006.
// «skipped» — отказ опрашивать: строки в БД не получает, виден только в ответе API.
const POLL_OUTCOMES = {
  OK: 'ok',
  PARTIAL: 'partial',
  FAILED: 'failed',
};

const SKIP_OUTCOME = 'skipped';
const SKIP_CODES = {
  MIN_INTERVAL: 'min_interval',
  ALREADY_RUNNING: 'already_running',
  UNKNOWN_ADAPTER: 'unknown_adapter',
};

const DEADLINE_CODE = 'deadline';

// Опрос без finished_at дольше дедлайна читается как прерванный (store.js), а не пишется.
const INTERRUPTED_CODE = 'interrupted';

module.exports = { POLL_OUTCOMES, SKIP_OUTCOME, SKIP_CODES, DEADLINE_CODE, INTERRUPTED_CODE };
