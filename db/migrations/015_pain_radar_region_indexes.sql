-- Регион — обязательная координата витрины: фильтр «боли в городе N» и «по области
-- (поддереву)» должен быть быстрым всегда. Иерархия и словарь — radar_regions (005);
-- в pain-radar храним самый точный уровень (город), область вытягивается через parent_id.

CREATE INDEX pain_radar_organizations_region_idx ON pain_radar_organizations (city_region_id);
CREATE INDEX pain_radar_jobs_region_idx ON pain_radar_jobs (city_region_id);
CREATE INDEX pain_radar_ideas_region_idx ON pain_radar_ideas (city_region_id);
