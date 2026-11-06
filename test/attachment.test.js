import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAttachment } from '../src/index.js';
const base = { chat: { id: -42 }, message_id: 9 };
test('ignores text', () => assert.equal(selectAttachment({ ...base, text: 'Hi' }), null));
test('picks largest Telegram photo', () => {
  const result = selectAttachment({ ...base, photo: [{ file_id: 'small' }, { file_id: 'large', file_size: 200 }] });
  assert.equal(result.fileId, 'large');
  assert.equal(result.filename, 'telegram-photo--42-9.jpg');
});
test('accepts PDF', () => assert.equal(selectAttachment({ ...base, document: { file_id: 'pdf', mime_type: 'application/pdf', file_name: 'invoice.pdf' } }).fileId, 'pdf'));
test('accepts image document', () => assert.equal(selectAttachment({ ...base, document: { file_id: 'png', mime_type: 'image/png', file_name: 'scan.png' } }).fileId, 'png'));
test('rejects mp3', () => assert.equal(selectAttachment({ ...base, document: { file_id: 'audio', mime_type: 'audio/mpeg', file_name: 'song.mp3' } }), null));
