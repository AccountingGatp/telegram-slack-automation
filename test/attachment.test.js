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
test('accepts audio documents', () => assert.equal(selectAttachment({ ...base, document: { file_id: 'audio', mime_type: 'audio/mpeg', file_name: 'song.mp3' } }).filename, 'song.mp3'));

const officeTypes = [
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
];
for (const [extension, mimeType] of officeTypes) {
  test(`accepts ${extension} and preserves the filename`, () => {
    const document = { file_id: 'office', file_name: `Client File.${extension}`, mime_type: mimeType };
    assert.deepEqual(selectAttachment({ ...base, document }), {
      fileId: 'office', filename: document.file_name, mimeType, size: undefined
    });
  });
  test(`accepts uppercase ${extension} with a generic MIME type`, () => {
    const document = { file_id: 'office', file_name: `Client.${extension.toUpperCase()}`, mime_type: 'application/octet-stream' };
    assert.equal(selectAttachment({ ...base, document }).fileId, 'office');
  });
  test(`accepts ${extension} MIME type without a filename`, () => {
    assert.equal(selectAttachment({ ...base, document: { file_id: 'office', mime_type: mimeType } }).fileId, 'office');
  });
}
test('accepts arbitrary documents', () => {
  assert.equal(selectAttachment({ ...base, document: { file_id: 'zip', file_name: 'archive.zip', mime_type: 'application/zip' } }).filename, 'archive.zip');
});
