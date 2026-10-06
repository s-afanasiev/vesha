// Песочница Playwright MCP: MCP-клиент поверх @playwright/mcp (stdio-транспорт).
// Браузер запускается в видимом окне (headed) — с локальной машины видно, куда он ходит.
// Всё, что возвращает MCP (промежуточные результаты, a11y-снапшоты, ошибки) — сырым текстом
// в кольцевой лог; UI читает приращения по seq. Задачи выполняются по одной (state.busy).

const path = require('node:path');
const fs = require('node:fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const MAX_LOG = 2000;
const MAX_TEXT = 150000; // потолок одной записи лога (снапшоты бывают огромными)

const state = {
  client: null,
  transport: null,
  connected: false,
  connecting: null,
  headless: false,
  busy: false,
  tools: [],
  seq: 0,
  log: [],
  lastTask: null,
};

function log(kind, text) {
  text = String(text ?? '');
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\n…(обрезано, ' + text.length + ' симв.)';
  state.log.push({ ts: new Date().toISOString(), seq: ++state.seq, kind, text });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

function cliPath() {
  const pkgPath = require.resolve('@playwright/mcp/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bin = Object.values(pkg.bin || {})[0];
  if (!bin) throw new Error('у @playwright/mcp не найден bin');
  return path.join(path.dirname(pkgPath), bin);
}

async function ensureConnected(headless) {
  if (state.connected && state.client) return;
  if (state.connecting) return state.connecting;

  state.connecting = (async () => {
    state.headless = !!headless;
    const cli = cliPath();
    const args = [cli];
    if (state.headless) args.push('--headless');
    log('info', `запускаю MCP-сервер: ${args.join(' ')} ${state.headless ? '(без окна)' : '(окно браузера будет видно)'}`);
    log('info', 'первое подключение открывает браузер — окно появится на экране');

    const transport = new StdioClientTransport({ command: process.execPath, args });
    transport.onerror = (e) => log('error', 'транспорт: ' + (e?.message || e));
    transport.onclose = () => {
      if (state.connected) log('error', 'MCP-сервер закрылся (окно браузера закрыто?)');
      state.connected = false;
      state.client = null;
      state.transport = null;
    };

    const client = new Client({ name: 'vesha-mcp-sandbox', version: '0.1.0' });
    await client.connect(transport);
    state.client = client;
    state.transport = transport;
    state.connected = true;

    const listed = await client.listTools();
    state.tools = listed.tools.map((t) => t.name);
    log('info', `подключено. инструментов ${state.tools.length}: ${state.tools.join(', ')}`);
  })();

  try {
    await state.connecting;
  } finally {
    state.connecting = null;
  }
}

function renderToolResult(res) {
  if (!res) return '(пустой ответ)';
  const body = (res.content || []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
  return (res.isError ? '[инструмент вернул ошибку]\n' : '') + (body || JSON.stringify(res));
}

function taskToUrl(task) {
  const t = task.trim();
  if (!t) throw new Error('пустой запрос');
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t)) return 'https://' + t;
  return 'https://www.google.com/search?q=' + encodeURIComponent(t);
}

async function run(task, headless) {
  if (state.busy) throw new Error('предыдущая задача ещё выполняется — подожди или закрой браузер');
  state.busy = true;
  state.lastTask = task;
  try {
    await ensureConnected(headless);
    const url = taskToUrl(task);
    log('tool', `→ browser_navigate { url: "${url}" }`);
    const nav = await state.client.callTool({ name: 'browser_navigate', arguments: { url } });
    log('result', renderToolResult(nav));

    log('tool', '→ browser_snapshot {} (accessibility-дерево страницы)');
    const snap = await state.client.callTool({ name: 'browser_snapshot', arguments: {} });
    log('result', renderToolResult(snap));
    log('info', 'задача завершена. Браузер остаётся открытым — следующий запрос пойдёт в то же окно.');
  } catch (e) {
    log('error', (e?.message || String(e)) + '\nподсказка: если браузер не нашёлся — запусти в терминале `npx playwright install chromium`');
    throw e;
  } finally {
    state.busy = false;
  }
}

async function stop() {
  if (!state.client) {
    log('info', 'бразуер не запущен');
    return;
  }
  try {
    await state.client.callTool({ name: 'browser_close', arguments: {} });
    log('info', 'браузер закрыт (browser_close)');
  } catch (e) {
    log('error', 'browser_close: ' + (e?.message || e));
  }
  try {
    await state.transport?.close();
  } catch {}
  state.connected = false;
  state.client = null;
  state.transport = null;
}

function publicState(since) {
  const from = Math.max(0, Number(since) || 0);
  return {
    connected: state.connected,
    busy: state.busy,
    headless: state.headless,
    tools: state.tools,
    lastSeq: state.seq,
    log: state.log.filter((l) => l.seq > from),
  };
}

module.exports = { run, stop, publicState };
