const assert = require('node:assert/strict');
const test = require('node:test');
const cloudAIService = require('../src/services/cloudAIService');
const catalogService = require('../src/services/catalogService');

function responseFromBytes(bytes) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  }), { status: 200 });
}

function stubStreamEnvironment(t) {
  const previous = {
    refreshKeys: cloudAIService.refreshKeys,
    checkServable: catalogService.checkServable,
  };
  cloudAIService.refreshKeys = () => {};
  catalogService.checkServable = async () => ({ ok: true, availability: 'available' });
  t.after(() => {
    cloudAIService.refreshKeys = previous.refreshKeys;
    catalogService.checkServable = previous.checkServable;
  });
}

test('parses chunked UTF-8 SSE, forwards deltas, and preserves usage', async (t) => {
  const previous = {
    fetch: global.fetch,
    key: cloudAIService.omnirouteKey,
    base: cloudAIService.omnirouteBase,
  };
  t.after(() => {
    global.fetch = previous.fetch;
    cloudAIService.omnirouteKey = previous.key;
    cloudAIService.omnirouteBase = previous.base;
  });
  cloudAIService.omnirouteKey = 'mock-only';
  cloudAIService.omnirouteBase = 'http://mock.invalid/v1';

  const body = [
    `data: ${JSON.stringify({ model: 'upstream-mock', choices: [{ delta: { content: 'Hello ' } }] })}\r\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: '🌍' } }] })}\r\n`,
    `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 7 } })}\r\n`,
    'data: [DONE]',
  ].join('');
  const bytes = new TextEncoder().encode(body);
  let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return responseFromBytes(bytes);
  };

  const deltas = [];
  const result = await cloudAIService.callOmniRouteStream(
    cloudAIService.DEFAULT_MODEL,
    [{ role: 'user', content: 'Say hello' }],
    'Be concise',
    [],
    0.4,
    {},
    (delta) => deltas.push(delta),
  );

  assert.equal(request.url, 'http://mock.invalid/v1/chat/completions');
  assert.equal(request.body.model, cloudAIService.DEFAULT_MODEL.slice('omniroute/'.length));
  assert.equal(request.body.stream, true);
  assert.deepEqual(deltas, ['Hello ', '🌍']);
  assert.equal(result.text, 'Hello 🌍');
  assert.equal(result.tokensUsed, 7);
  assert.equal(result.modelUsed, cloudAIService.DEFAULT_MODEL);
  assert.equal(result.upstreamModel, 'upstream-mock');
});

test('rejects content streams that close without the completion marker', async (t) => {
  const previous = {
    fetch: global.fetch,
    key: cloudAIService.omnirouteKey,
    base: cloudAIService.omnirouteBase,
  };
  t.after(() => {
    global.fetch = previous.fetch;
    cloudAIService.omnirouteKey = previous.key;
    cloudAIService.omnirouteBase = previous.base;
  });
  cloudAIService.omnirouteKey = 'mock-only';
  cloudAIService.omnirouteBase = 'http://mock.invalid/v1';
  const partial = `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial answer' } }] })}\n`;
  global.fetch = async () => responseFromBytes(new TextEncoder().encode(partial));

  await assert.rejects(
    cloudAIService.callOmniRouteStream(
      cloudAIService.DEFAULT_MODEL, [{ role: 'user', content: 'test' }], '', [], 0.7,
    ),
    (error) => error.code === 'STREAM_INCOMPLETE' && /completion marker/.test(error.message),
  );
});

test('falls back to buffered completion only when streaming fails before any token', async (t) => {
  stubStreamEnvironment(t);
  const previous = {
    callOmniRouteStream: cloudAIService.callOmniRouteStream,
    generateCompletion: cloudAIService.generateCompletion,
  };
  t.after(() => {
    cloudAIService.callOmniRouteStream = previous.callOmniRouteStream;
    cloudAIService.generateCompletion = previous.generateCompletion;
  });
  let bufferedCalls = 0;
  cloudAIService.callOmniRouteStream = async () => { throw new Error('stream unavailable'); };
  cloudAIService.generateCompletion = async () => {
    bufferedCalls += 1;
    return { text: 'buffered answer', modelUsed: cloudAIService.DEFAULT_MODEL };
  };

  const result = await cloudAIService.streamCompletion({
    model: cloudAIService.DEFAULT_MODEL,
    messages: [{ role: 'user', content: 'test' }],
  });
  assert.equal(result.text, 'buffered answer');
  assert.equal(bufferedCalls, 1);
});

test('does not repeat generation after streamed content has already been emitted', async (t) => {
  stubStreamEnvironment(t);
  const previous = {
    callOmniRouteStream: cloudAIService.callOmniRouteStream,
    generateCompletion: cloudAIService.generateCompletion,
  };
  t.after(() => {
    cloudAIService.callOmniRouteStream = previous.callOmniRouteStream;
    cloudAIService.generateCompletion = previous.generateCompletion;
  });
  let bufferedCalls = 0;
  cloudAIService.callOmniRouteStream = async (...args) => {
    args[6]('partial answer');
    throw new Error('stream interrupted');
  };
  cloudAIService.generateCompletion = async () => {
    bufferedCalls += 1;
    return { text: 'duplicate answer', modelUsed: cloudAIService.DEFAULT_MODEL };
  };

  await assert.rejects(
    cloudAIService.streamCompletion({
      model: cloudAIService.DEFAULT_MODEL,
      messages: [{ role: 'user', content: 'test' }],
      onToken: () => {},
    }),
    /stream interrupted/,
  );
  assert.equal(bufferedCalls, 0);
});

test('does not retry a stream timeout through buffered generation', async (t) => {
  stubStreamEnvironment(t);
  const previous = {
    callOmniRouteStream: cloudAIService.callOmniRouteStream,
    generateCompletion: cloudAIService.generateCompletion,
  };
  t.after(() => {
    cloudAIService.callOmniRouteStream = previous.callOmniRouteStream;
    cloudAIService.generateCompletion = previous.generateCompletion;
  });
  let bufferedCalls = 0;
  cloudAIService.callOmniRouteStream = async () => {
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  };
  cloudAIService.generateCompletion = async () => {
    bufferedCalls += 1;
    return { text: 'unexpected duplicate', modelUsed: cloudAIService.DEFAULT_MODEL };
  };

  await assert.rejects(
    cloudAIService.streamCompletion({
      model: cloudAIService.DEFAULT_MODEL,
      messages: [{ role: 'user', content: 'test' }],
    }),
    (error) => error.code === 'ETIMEDOUT',
  );
  assert.equal(bufferedCalls, 0);
});
