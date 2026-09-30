const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHierarchicalItems, parseTags } = require('../server/services/super-notes/parser');
const { createNote, listNotes, deleteNote, getTagCloud } = require('../server/services/super-notes/store');
const { syncNoteEmbedding, searchSemantic } = require('../server/services/super-notes/embedder');
const db = require('../server/db');

test('parseHierarchicalItems: parses dash-separated tools and links', () => {
  const input = `
    plasma-discover - https://userbase.kde.org/Discover - GUI центр приложений KDE
    stplr - https://github.com/stplr - Консольная утилита
    apm - https://atom.io/packages - Менеджер пакетов Atom
    flatpak - https://flatpak.org - Универсальные песочницы приложений
  `;

  const items = parseHierarchicalItems(input);
  assert.equal(items.length, 4);

  assert.equal(items[0].title, 'plasma-discover');
  assert.equal(items[0].url, 'https://userbase.kde.org/Discover');
  assert.equal(items[0].description, 'GUI центр приложений KDE');

  assert.equal(items[3].title, 'flatpak');
  assert.equal(items[3].url, 'https://flatpak.org');
});

test('parseHierarchicalItems: parses markdown links', () => {
  const input = `
    * [plasma-discover](https://userbase.kde.org/Discover) — KDE Store
    * [flatpak](https://flatpak.org) — Sandboxing
  `;

  const items = parseHierarchicalItems(input);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'plasma-discover');
  assert.equal(items[0].url, 'https://userbase.kde.org/Discover');
  assert.equal(items[0].description, 'KDE Store');
});

test('parseTags: normalizes tags and handles # and commas', () => {
  const tags = parseTags('#linux, #tools, devops; #Linux');
  assert.deepEqual(tags.sort(), ['devops', 'linux', 'tools']);
});

test('super-notes store: create, list, tag cloud and cleanup in DB', async () => {
  // Тестовый гость
  const guestRes = await db.query(`INSERT INTO guests DEFAULT VALUES RETURNING id`);
  const guestId = guestRes.rows[0].id;
  const mockReq = { guest: { id: guestId }, user: null };

  try {
    // 1. Создание иерархической заметки
    const note = await createNote({
      title: 'Тест: Пакетные менеджеры Linux',
      tags: '#linux, #tools',
      is_pinned: true,
      content_raw: `
plasma-discover - https://userbase.kde.org/Discover - GUI центр
flatpak - https://flatpak.org - Песочницы
      `,
    }, mockReq);

    assert.ok(note.id);
    assert.equal(note.title, 'Тест: Пакетные менеджеры Linux');
    assert.equal(note.is_pinned, true);
    assert.equal(note.items_json.length, 2);
    assert.equal(note.tags.length, 2);

    // 2. Генерация эмбеддинга
    await syncNoteEmbedding(note);

    // 3. Выборка и фильтрация по тегу
    const listRes = await listNotes({ req: mockReq, tag: 'linux' });
    assert.equal(listRes.notes.length, 1);
    assert.equal(listRes.notes[0].id, note.id);

    // 4. Проверка облака тегов
    const tagsCloud = await getTagCloud(mockReq);
    assert.ok(tagsCloud.length >= 2);
    const linuxTag = tagsCloud.find(t => t.name === 'linux');
    assert.ok(linuxTag);
    assert.equal(linuxTag.count, 1);

    // 5. Семантический поиск
    const semResults = await searchSemantic({ req: mockReq, query: 'программы для линукс' });
    assert.ok(Array.isArray(semResults));
    assert.ok(semResults.length >= 1);
    assert.equal(semResults[0].id, note.id);

    // 6. Удаление
    const deleted = await deleteNote(note.id, mockReq);
    assert.equal(deleted, true);

    const checkList = await listNotes({ req: mockReq });
    assert.equal(checkList.notes.length, 0);
  } finally {
    await db.query(`DELETE FROM guests WHERE id = $1`, [guestId]);
  }
});
