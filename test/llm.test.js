const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../server/config');
const { completeChat, parseClientOptions, __test } = require('../server/services/llm');

const originalFetch = global.fetch;
const originalConfig = {
  isProduction: config.isProduction,
  geminiApiKey: config.geminiApiKey,
  geminiModel: config.geminiModel,
  openaiApiKey: config.openaiApiKey,
  openaiBaseUrl: config.openaiBaseUrl,
  openaiModel: config.openaiModel,
  openaiAllowKeyless: config.openaiAllowKeyless,
  llmMaxResponseBytes: config.llmMaxResponseBytes,
  llmEnableCustomEndpoints: config.llmEnableCustomEndpoints,
  llmAllowPrivateEndpoints: config.llmAllowPrivateEndpoints,
  llmAllowedOpenaiHosts: [...config.llmAllowedOpenaiHosts],
};

test.afterEach(() => {
  Object.assign(config, originalConfig, {
    llmAllowedOpenaiHosts: [...originalConfig.llmAllowedOpenaiHosts],
  });
  global.fetch = originalFetch;
});

function jsonResponse(data, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(data),
  };
}

const messages = [{ role: 'user', content: 'hello' }];

test('provider parsing drops fields belonging to other providers', () => {
  assert.deepEqual(
    parseClientOptions({
      provider: 'gemini',
      apiKey: ' g ',
      baseUrl: 'https://attacker.example',
      model: 'attacker',
      folderId: 'folder',
    }),
    { provider: 'gemini', apiKey: 'g' }
  );
  assert.deepEqual(
    parseClientOptions({ provider: 'yandex', apiKey: ' y ', folderId: ' f ', baseUrl: 'x' }),
    { provider: 'yandex', apiKey: 'y', folderId: 'f' }
  );
});

test('server OpenAI key is never sent to a client-selected URL', async () => {
  config.openaiApiKey = 'server-secret';
  config.openaiBaseUrl = 'https://api.openai.com/v1';
  config.openaiModel = 'server-model';
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return jsonResponse({
      model: 'server-model',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
  };

  await completeChat({
    selection: {
      provider: 'openai',
      baseUrl: 'https://attacker.example/v1',
      model: 'attacker-model',
      maxTokens: 999999,
    },
    messages,
  });

  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer server-secret');
  assert.equal(JSON.parse(request.options.body).model, 'server-model');
  assert.equal(JSON.parse(request.options.body).max_tokens, config.llmServerMaxTokens);
});

test('custom endpoint requires user key and server permission', async () => {
  config.openaiBaseUrl = 'https://api.openai.com/v1';
  config.openaiApiKey = 'server-secret';
  config.llmEnableCustomEndpoints = false;

  await assert.rejects(
    completeChat({
      selection: {
        provider: 'openai',
        apiKey: 'user-secret',
        baseUrl: 'https://8.8.8.8/v1',
        model: 'custom-model',
      },
      messages,
    }),
    /Пользовательские LLM URL отключены/
  );
});

test('custom endpoint policy blocks private networks and production without allowlist', async () => {
  config.llmEnableCustomEndpoints = true;
  config.llmAllowPrivateEndpoints = false;
  config.isProduction = false;
  config.llmAllowedOpenaiHosts = [];

  await assert.rejects(
    __test.assertCustomEndpointAllowed(new URL('https://127.0.0.1/v1/chat/completions')),
    /локальную или внутреннюю сеть/
  );
  await assert.doesNotReject(
    __test.assertCustomEndpointAllowed(new URL('https://8.8.8.8/v1/chat/completions'))
  );
  config.llmAllowPrivateEndpoints = true;
  await assert.doesNotReject(
    __test.assertCustomEndpointAllowed(new URL('http://127.0.0.1/v1/chat/completions'))
  );
  await assert.rejects(
    __test.assertCustomEndpointAllowed(new URL('http://8.8.8.8/v1/chat/completions')),
    /должен использовать HTTPS/
  );

  config.isProduction = true;
  await assert.rejects(
    __test.assertCustomEndpointAllowed(new URL('https://8.8.8.8/v1/chat/completions')),
    /LLM_ALLOWED_OPENAI_HOSTS/
  );
});

test('Gemini key is sent in a header, not in the URL', async () => {
  config.geminiApiKey = '';
  config.geminiModel = 'gemini-test';
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return jsonResponse({
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    });
  };

  await completeChat({
    selection: { provider: 'gemini', apiKey: 'user-secret' },
    messages,
  });

  assert.doesNotMatch(request.url, /user-secret/);
  assert.equal(request.options.headers['x-goog-api-key'], 'user-secret');
  assert.equal(request.options.redirect, 'manual');
});

test('oversized upstream responses are rejected', async () => {
  config.geminiApiKey = '';
  config.llmMaxResponseBytes = 16;
  global.fetch = async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'too large' }] } }] }));

  await assert.rejects(
    completeChat({
      selection: { provider: 'gemini', apiKey: 'user-key' },
      messages,
    }),
    /ответ превышает лимит/
  );
});

test('OpenAI endpoint path is normalized once', () => {
  assert.equal(
    __test.openaiChatUrl('https://example.com/v1').href,
    'https://example.com/v1/chat/completions'
  );
  assert.equal(
    __test.openaiChatUrl('https://example.com/v1/chat/completions').href,
    'https://example.com/v1/chat/completions'
  );
});

test('private and reserved IP ranges are rejected', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.2', '::1', 'fd00::1']) {
    assert.equal(__test.isBlockedIp(address), true, address);
  }
  assert.equal(__test.isBlockedIp('8.8.8.8'), false);
  assert.equal(__test.isBlockedIp('2001:4860:4860::8888'), false);
});
