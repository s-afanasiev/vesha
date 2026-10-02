-- Chat Engine (docs/chat-engine-architecture.md): скелет «виджет сайта → диалог →
-- LLM-черновик → согласование менеджером». Минимум ядра Scout+Anna: карточка диалога,
-- единая история с черновиками-пендингами, журнал этапов, персона ассистента.

CREATE TABLE chat_engine_dialogues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT 'web',
  visitor_key TEXT NOT NULL,
  visitor_name TEXT NOT NULL DEFAULT 'Гость',
  stage TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  last_incoming_at TIMESTAMPTZ,
  last_outgoing_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, visitor_key)
);

-- Черновик эволюционирует в своей строке: open → approved | edited | rejected | superseded.
CREATE TABLE chat_engine_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dialogue_id UUID NOT NULL REFERENCES chat_engine_dialogues(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('visitor', 'manager', 'draft')),
  state TEXT NOT NULL DEFAULT 'sent' CHECK (state IN ('sent', 'open', 'approved', 'edited', 'rejected', 'superseded')),
  text TEXT NOT NULL,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX chat_engine_messages_external_id_idx
  ON chat_engine_messages (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX chat_engine_messages_dialogue_idx ON chat_engine_messages (dialogue_id, created_at);

CREATE TABLE chat_engine_stage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dialogue_id UUID NOT NULL REFERENCES chat_engine_dialogues(id) ON DELETE CASCADE,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  actor TEXT NOT NULL,
  cause TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_engine_stage_log_dialogue_idx ON chat_engine_stage_log (dialogue_id, created_at);

CREATE TABLE chat_engine_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO chat_engine_settings (key, value) VALUES (
  'persona',
  E'Ты — ассистент менеджера компании: помогаешь отвечать клиентам в переписке на сайте.\nТон: вежливый, живой, по-человечески, без канцелярита. Обращайся на «вы».\nОбъём: 2–5 предложений, по делу.\nПравила:\n— не выдумывай цены, сроки и условия: пользуйся только тем, что есть в переписке или заметках;\n— если данных не хватает — задай один вежливый уточняющий вопрос;\n— не обещай то, что должен подтвердить менеджер;\n— пиши от первого лица от лица компании.'
) ON CONFLICT (key) DO NOTHING;
