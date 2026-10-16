-- «Кому автоматизировать», шаг 2 (docs/automation-leads-architecture.md, «Шаги»):
-- лид — «я × компания × оффер» со своей судьбой; воронка владельца с колонками
-- смысловых типов (те же, что у доски костяка); мост вех дерева процессов.
-- Журнал переходов — общая journal_events (018): stream 'lead', scope — воронка.
-- 020 занята параллельной веткой костяка — порядок номеров тут не важен:
-- раннер накатывает каждый файл по имени ровно один раз.

-- Воронка — одна на владельца («я»): колонки и версия доски для конструктора.
CREATE TABLE lead_funnels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner TEXT NOT NULL UNIQUE,
  board_version INT NOT NULL DEFAULT 1,  -- оптимистичная блокировка конструктора
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Тип колонки — смысл (окно статуса, будущие замеры); название — вкус владельца.
CREATE TABLE lead_funnel_columns (
  funnel_id UUID NOT NULL REFERENCES lead_funnels(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('inbox', 'working', 'waiting_client', 'done', 'refused')),
  position INT NOT NULL,
  color TEXT,
  wip_limit INT CHECK (wip_limit IS NULL OR wip_limit > 0),
  PRIMARY KEY (funnel_id, id)
);

-- Лид. Компания — ключ источника ('2gis:<branch_id>') и снимок карточки на момент
-- разбора; доводы — снимок плана (балл, сбои, цитата, пробелы). Один оффер — один
-- лид: та же компания с другим оффером — другой лид.
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id UUID NOT NULL REFERENCES lead_funnels(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL,
  niche TEXT NOT NULL,
  company_key TEXT NOT NULL,
  company JSONB NOT NULL,
  offer TEXT NOT NULL,
  evidence JSONB NOT NULL,
  until DATE,                -- ждём до: выход по сроку из колонки ожидания
  reason TEXT,               -- причина последнего отказа
  do_not_contact TEXT,       -- причина «не беспокоить»; NULL — писать можно
  found_run TEXT,            -- прогон «Разобрать», который нашёл лид
  seen_run TEXT,             -- последний прогон, который видел компанию
  seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (funnel_id, company_key, offer),
  -- лид ссылается на колонку своей воронки: удалить колонку с карточками без
  -- переноса не даст сама база (второй рубеж после правила Board)
  FOREIGN KEY (funnel_id, column_id) REFERENCES lead_funnel_columns (funnel_id, id)
);

CREATE INDEX leads_board_idx ON leads (funnel_id, column_id);
CREATE INDEX leads_company_idx ON leads (funnel_id, company_key);

-- Вехи дерева процессов (server/process-tree/persist.js): снимок узла целиком,
-- запись пачкой. tree — чьё дерево; прогоны переживают рестарт, незакрытые узлы
-- прошлого процесса при восстановлении закрываются исходом interrupted.
CREATE TABLE process_tree_nodes (
  node_id UUID PRIMARY KEY,
  tree TEXT NOT NULL,
  root_id UUID NOT NULL,
  parent_id UUID,
  node JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX process_tree_nodes_root_idx ON process_tree_nodes (tree, root_id);
