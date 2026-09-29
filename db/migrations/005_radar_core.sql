-- Общий слой радаров: словари регионов и ниш (docs/idea-radar-architecture.md, «База данных»).
-- Пишет в эти таблицы только общий слой (server/services/radar/); радары читают.

CREATE TABLE radar_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('country', 'region', 'city')),
  parent_id UUID REFERENCES radar_regions(id) ON DELETE SET NULL
);

-- aliases — начала слов в нижнем регистре, «ё» → «е»; фраза из нескольких слов пишется через пробел.
CREATE TABLE radar_niches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  parent_id UUID REFERENCES radar_niches(id) ON DELETE SET NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  sort_order INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'proposed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX radar_niches_parent_idx ON radar_niches (parent_id);

INSERT INTO radar_regions (code, name, kind) VALUES ('ru', 'Россия', 'country');
INSERT INTO radar_regions (code, name, kind, parent_id)
  SELECT 'ru-46', 'Курская область', 'region', id FROM radar_regions WHERE code = 'ru';
INSERT INTO radar_regions (code, name, kind, parent_id)
  SELECT 'ru-46-kursk', 'Курск', 'city', id FROM radar_regions WHERE code = 'ru-46';

-- Стартовая персона — человек, которому близок ремонт автомобилей.
INSERT INTO radar_niches (slug, title, aliases, sort_order) VALUES
  ('auto', 'Автомобили: ремонт и обслуживание',
   ARRAY['автомоб', 'автосалон', 'автодилер', 'автовладел', 'водител', 'осаго'], 10);

INSERT INTO radar_niches (slug, title, aliases, sort_order, parent_id)
SELECT v.slug, v.title, v.aliases, v.sort_order, p.id
FROM (VALUES
  ('auto_service', 'ТО и слесарный ремонт',
   ARRAY['автосервис', 'автослесар', 'автомеханик', 'техобслуживан', 'техосмотр'], 1),
  ('auto_tires', 'Шиномонтаж',
   ARRAY['шиномонтаж', 'шин', 'покрышк', 'резин'], 2),
  ('auto_body', 'Кузов и покраска',
   ARRAY['кузов', 'автомаляр', 'маляр', 'рихтовк', 'полировк'], 3),
  ('auto_electric', 'Автоэлектрика и диагностика',
   ARRAY['автоэлектрик', 'электромобил', 'зарядн', 'аккумулятор', 'гибрид'], 4),
  ('auto_detailing', 'Мойка и детейлинг',
   ARRAY['автомойк', 'мойк', 'мойщик', 'детейлинг', 'химчистк салон'], 5),
  ('auto_parts', 'Запчасти',
   ARRAY['запчаст', 'автозапчаст', 'комплектующ', 'параллельн импорт'], 6),
  ('auto_inspection', 'Автоподбор и осмотр перед покупкой',
   ARRAY['автоподбор', 'подержанн', 'с пробег', 'вторичн рынк автомоб'], 7),
  ('auto_tow', 'Эвакуация и помощь на дороге',
   ARRAY['эвакуатор', 'техпомощ', 'помощ на дорог'], 8)
) AS v(slug, title, aliases, sort_order)
CROSS JOIN (SELECT id FROM radar_niches WHERE slug = 'auto') AS p;
