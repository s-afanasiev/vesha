// Точка сборки территории chat-engine (docs/oop-principles.md П3): по этому
// файлу видна вся система — Funnel (правило), DialogueRepository (истина),
// ReplySuggester (LLM), ChatDesk (дверь сценариев).

const db = require('../../db');
const { completeChat } = require('../llm');
const { ChatDesk } = require('./ChatDesk');
const { DialogueRepository } = require('./DialogueRepository');
const { ReplySuggester } = require('./ReplySuggester');
const { Funnel } = require('./Funnel');

const funnel = new Funnel();
const repository = new DialogueRepository(db);

const chatDesk = new ChatDesk({
  repository,
  suggester: new ReplySuggester({ repository, completeChat, funnel }),
  funnel,
});

module.exports = { chatDesk, funnel };
