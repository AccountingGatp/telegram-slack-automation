const MAX_BYTES = 20 * 1024 * 1024;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function selectAttachment(message) {
  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = message.photo[message.photo.length - 1];
    return {
      fileId: photo.file_id,
      filename: `telegram-photo-${message.chat.id}-${message.message_id}.jpg`,
      mimeType: 'image/jpeg',
      size: photo.file_size
    };
  }
  const doc = message.document;
  if (!doc) return null;
  const filename = doc.file_name || `telegram-document-${message.message_id}`;
  const mimeType = (doc.mime_type || '').toLowerCase();
  const isPDF = mimeType === 'application/pdf' || /\.pdf$/i.test(filename);
  const isImage = mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(filename);
  if (!isPDF && !isImage) return null;
  return { fileId: doc.file_id, filename, mimeType: mimeType || 'application/octet-stream', size: doc.file_size };
}

async function slackCall(method, token, body) {
  const formEncoded = method === 'files.getUploadURLExternal';
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': formEncoded ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8'
    },
    body: formEncoded ? new URLSearchParams(body).toString() : JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Slack ${method} HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error || 'unknown error'}`);
  return data;
}

async function forwardFile(message, attachment, env) {
  if (!attachment.fileId) throw new Error('Telegram attachment is missing file_id');
  if (attachment.size > MAX_BYTES) {
    console.warn(`Skipped large Telegram file (over 20 MB): ${message.message_id}`);
    return;
  }

  const tgApi = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  const fileResponse = await fetch(`${tgApi}/getFile?file_id=${encodeURIComponent(attachment.fileId)}`);
  if (!fileResponse.ok) throw new Error(`Telegram getFile HTTP ${fileResponse.status}`);
  const fileInfo = await fileResponse.json();
  if (!fileInfo.ok || !fileInfo.result?.file_path) throw new Error('Telegram getFile did not provide a file path');

  const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`;
  const downloadResponse = await fetch(fileUrl);
  if (!downloadResponse.ok) throw new Error(`Telegram download HTTP ${downloadResponse.status}`);
  const contentLength = Number(downloadResponse.headers.get('content-length') || '0');
  if (contentLength > MAX_BYTES) {
    await downloadResponse.body?.cancel();
    console.warn(`Skipped oversized downloaded file: ${message.message_id}`);
    return;
  }
  const buffer = await downloadResponse.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    console.warn(`Skipped oversized file: ${message.message_id}`);
    return;
  }

  const upload = await slackCall('files.getUploadURLExternal', env.SLACK_BOT_TOKEN, {
    filename: attachment.filename,
    length: buffer.byteLength
  });

  const binary = await fetch(upload.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buffer
  });
  if (!binary.ok) throw new Error(`Slack binary upload HTTP ${binary.status}`);

  const sender = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean).join(' ') || message.sender_chat?.title || 'Unknown sender';
  const caption = (message.caption || '').slice(0, 1500);
  const comment = [
    `Telegram file from: ${sender}`,
    `Source: ${message.chat.title || 'Private chat'}`,
    caption ? `Caption: ${caption}` : null
  ].filter(Boolean).join('\n');

  await slackCall('files.completeUploadExternal', env.SLACK_BOT_TOKEN, {
    files: [{ id: upload.file_id, title: attachment.filename }],
    channel_id: env.SLACK_CHANNEL_ID,
    initial_comment: comment
  });
  console.log(`Successfully forwarded Telegram message ${message.message_id}`);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('Telegram → Slack forwarder is online');
    }
    if (request.method !== 'POST' || url.pathname !== '/telegram') {
      return new Response('Not found', { status: 404 });
    }
    const required = ['TELEGRAM_BOT_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'WEBHOOK_SECRET'];
    if (required.some((key) => !env[key])) return new Response('Server not configured', { status: 503 });
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
    try {
      const update = await request.json();
      const message = update.message || update.channel_post;
      if (!message?.chat) return new Response('Ignored');
      if (env.TELEGRAM_CHAT_ID && String(message.chat.id) !== String(env.TELEGRAM_CHAT_ID)) {
        return new Response('Different chat ignored');
      }
      const attachment = selectAttachment(message);
      if (!attachment) return new Response('Not an image or PDF');
      await forwardFile(message, attachment, env);
      return new Response('OK');
    } catch (error) {
      console.error('Forwarding error:', error instanceof Error ? error.message : 'Unknown error');
      // A 5xx response asks Telegram to retry. If Slack accepted the upload before
      // a later failure, the retry can cause duplicate messages.
      return new Response('Temporary error', { status: 500 });
    }
  }
};
