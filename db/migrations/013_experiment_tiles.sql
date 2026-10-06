-- Каталог плиток: истина состава — registry.json, истина доступа — здесь.
-- Ключ плитки: category + name (UNIQUE); полный путь собирается при отдаче каталога.
create table experiment_tiles (
  id serial primary key,
  category text not null default 'experiments',
  name text not null,
  visibility text not null default 'all',  -- all | admin
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, name)
);

-- Служебные части публичной плитки (например, админский пульт 2ГИС внутри pain-radar).
create table experiment_tile_parts (
  id serial primary key,
  tile_id integer not null references experiment_tiles(id) on delete cascade,
  part_key text not null,
  title text,
  visibility text not null default 'all',  -- all | admin
  enabled boolean not null default true,
  unique (tile_id, part_key)
);
