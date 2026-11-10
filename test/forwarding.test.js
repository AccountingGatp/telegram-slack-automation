import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = {
  TELEGRAM_BOT_TOKEN: 'test-telegram-token',
  SLACK_BOT_TOKEN: 'test-slack-token',
  SLACK_CHANNEL_ID: 'C_TEST',
  TELEGRAM_CHAT_ID: '-42',
  WEBHOOK_SECRET: 'test-secret'
};
const base = { chat: { id: -42, title: 'Client group' }, message_id: 19, from: { first_name: 'Client' } };
const request = (message, secret = env.WEBHOOK_SECRET) => new Request('https://worker.test/telegram', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
  body: JSON.stringify({ message })
});
const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

test('forwards complete text with sender and source as plain text', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return json({ ok: true });
  });
  const text = 'Please review <@U123> & this statement.\n' + 'x'.repeat(4096);
  const response = await worker.fetch(request({ ...base, text }), env);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://slack.com/api/chat.postMessage');
  assert.equal(calls[0].body.text, 'From: Client - (Client group)\n- ' + text);
  assert.equal(calls[0].body.channel, 'C_TEST');
  assert.equal(calls[0].body.mrkdwn, false);
  assert.equal(calls[0].body.unfurl_links, false);
});

for (const [kind, media, filename] of [
  ['voice', { mime_type: 'audio/ogg' }, 'telegram-voice--42-19.ogg'],
  ['audio', { file_name: 'recording.mp3' }, 'recording.mp3'],
  ['video', { file_name: 'client.mp4' }, 'client.mp4'],
  ['animation', {}, 'telegram-animation--42-19.mp4'],
  ['video_note', {}, 'telegram-video_note--42-19.mp4'],
  ['sticker', { is_video: true }, 'telegram-sticker--42-19.webm'],
  ['document', { file_name: 'transactions.csv', mime_type: 'text/csv' }, 'transactions.csv']
]) {
  test('uploads ' + kind + ' bytes and caption to Slack without a duplicate text post', async (t) => {
    const calls = [];
    const bytes = new Uint8Array([1, 2, 3]);
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/getFile?')) return json({ ok: true, result: { file_path: 'files/test' } });
      if (url.includes('/file/bot')) return new Response(bytes);
      if (url.endsWith('/files.getUploadURLExternal')) return json({ ok: true, upload_url: 'https://upload.test/file', file_id: 'F_TEST' });
      if (url === 'https://upload.test/file') {
        assert.deepEqual(new Uint8Array(options.body), bytes);
        return new Response('OK');
      }
      if (url.endsWith('/files.completeUploadExternal')) return json({ ok: true });
      throw new Error('Unexpected request: ' + url);
    });
    const response = await worker.fetch(request({ ...base, caption: 'Client caption', [kind]: { file_id: 'TG_TEST', file_size: 3, ...media } }), env);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 5);
    const upload = new URLSearchParams(calls[2].options.body);
    assert.equal(upload.get('filename'), filename);
    assert.equal(upload.get('length'), '3');
    const completion = JSON.parse(calls[4].options.body);
    assert.equal(completion.channel_id, env.SLACK_CHANNEL_ID);
    assert.equal(completion.files[0].title, filename);
    assert.equal(completion.initial_comment, 'From: Client - (Client group)\n- Client caption');
  });
}

test('does not contact Slack for another chat, invalid secret, or oversized voice note', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not send'); });
  assert.equal((await worker.fetch(request({ ...base, chat: { id: 123 }, text: 'Private' }), env)).status, 200);
  assert.equal((await worker.fetch(request({ ...base, text: 'Private' }, 'wrong'), env)).status, 401);
  assert.equal((await worker.fetch(request({ ...base, voice: { file_id: 'large', file_size: 21 * 1024 * 1024 } }), env)).status, 200);
});

test('returns retryable failure when Slack lacks chat:write', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ ok: false, error: 'missing_scope' }));
  assert.equal((await worker.fetch(request({ ...base, text: 'Hello' }), env)).status, 500);
});

test('ignores service events', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not send'); });
  const response = await worker.fetch(request({ ...base, new_chat_members: [{ id: 2 }] }), env);
  assert.equal(await response.text(), 'Unsupported message type');
});

test('routes three allowed Telegram chats to the same Slack channel with their source names', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return json({ ok: true });
  });
  const multipleEnv = { ...env, TELEGRAM_CHAT_ID: ' -42, -10043, -10044, ' };
  for (const id of [-42, -10043, -10044]) {
    const response = await worker.fetch(request({ ...base, chat: { id, title: 'Source ' + id }, text: 'Client message' }), multipleEnv);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'OK');
  }
  assert.equal(calls.length, 3);
  calls.forEach((call, index) => {
    assert.equal(call.body.channel, env.SLACK_CHANNEL_ID);
    assert.ok(call.body.text.startsWith('From: Client - (Source ' + [-42, -10043, -10044][index] + ')\n'));
  });
  const ignored = await worker.fetch(request({ ...base, chat: { id: -1004 }, text: 'Other client' }), multipleEnv);
  assert.equal(await ignored.text(), 'Different chat ignored');
  assert.equal(calls.length, 3);
});

test('forwards a document channel_post from another allowed channel', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/getFile?')) return json({ ok: true, result: { file_path: 'documents/statement' } });
    if (url.includes('/file/bot')) return new Response(new Uint8Array([1, 2]));
    if (url.endsWith('/files.getUploadURLExternal')) return json({ ok: true, upload_url: 'https://upload.test/file', file_id: 'F_TEST' });
    if (url === 'https://upload.test/file') return new Response('OK');
    if (url.endsWith('/files.completeUploadExternal')) return json({ ok: true });
    throw new Error('Unexpected request: ' + url);
  });
  const channelPost = { ...base, chat: { id: -10044, title: 'Client documents' }, document: { file_id: 'doc', file_name: 'statement.pdf', file_size: 2 } };
  const req = new Request('https://worker.test/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': env.WEBHOOK_SECRET },
    body: JSON.stringify({ channel_post: channelPost })
  });
  const response = await worker.fetch(req, { ...env, TELEGRAM_CHAT_ID: '-42,-10043,-10044' });
  assert.equal(await response.text(), 'OK');
  const completion = JSON.parse(calls[4].options.body);
  assert.equal(completion.channel_id, env.SLACK_CHANNEL_ID);
  assert.equal(completion.files[0].title, 'statement.pdf');
  assert.ok(completion.initial_comment.startsWith('From: Client - (Client documents)'));
});

test('an empty comma list does not allow messages from every chat', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not send'); });
  const response = await worker.fetch(request({ ...base, text: 'Hello' }), { ...env, TELEGRAM_CHAT_ID: ' , , ' });
  assert.equal(await response.text(), 'Different chat ignored');
});
