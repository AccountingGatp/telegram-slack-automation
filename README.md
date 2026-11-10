# Telegram messages and files → Slack (Cloudflare Workers)

A small, webhook-driven Cloudflare Worker that sends Telegram **text messages, photos, voice notes, audio, videos, video notes, animations, stickers, and all document types** into a Slack channel. This includes PDF, Excel, Word, CSV, ZIP, and other files. Voice notes are uploaded as audio files without transcription. Service events, polls, contacts, locations, and edits/deletions are not mirrored. **No Zapier tasks or server to manage.**

> Designed for small receipt files. Free-plan resource limits apply; production delivery and Slack permissions must be verified with real test messages.

## 1. Requirements

- Node.js 20+ and a free Cloudflare account.
- A Telegram bot token from [@BotFather](https://t.me/BotFather). The bot must be in your group and have group privacy disabled and be re-added, or be an administrator as appropriate.
- A Slack app created at https://api.slack.com/apps with Bot Token Scopes **`files:write` and `chat:write`**, installed to your workspace. Invite the Slack bot to the destination channel via `/invite @YourBotName`.
- Your desired Telegram chat ID and Slack channel ID.

This project defaults to no secrets. Never commit the real bot tokens, the Slack token, or your webhook secret to GitHub.

## 2. Install and deploy

```bash
npm install
npm test
npx wrangler login
npm run deploy
```

Wrangler prints the published Worker URL, e.g. `https://telegram-slack-automation.<subdomain>.workers.dev`. Its Telegram receiver endpoint is that URL **plus `/telegram`**.

## 3. Set production secrets

Run these one by one in your terminal, pasting each value **when prompted**:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_CHANNEL_ID
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put WEBHOOK_SECRET
```

For initial testing, the previously selected Slack channel was `#testing_msg` (`C0BT49GTZPT`) and the test Telegram group `test-2` was `-5276643267`. **Verify both IDs in your accounts before using them**. Use a long, random `WEBHOOK_SECRET` consisting only of letters, numbers, underscores and hyphens.

Alternatively, configure the same values in Cloudflare Dashboard → Workers & Pages → your Worker → Settings → Variables and Secrets, using Secret for credentials.

## 4. Register Telegram webhook

**First disable the old Zapier Telegram Zap.** Only one webhook endpoint can be active for this Telegram bot.

Open PowerShell and run (edit the values):

```powershell
$token = 'PASTE_YOUR_TELEGRAM_BOT_TOKEN_HERE'
$workerUrl = 'https://telegram-slack-automation.YOUR-SUBDOMAIN.workers.dev/telegram'
$secret = 'SAME_WEBHOOK_SECRET_AS_CLOUDFLARE'
$payload = @{
  url = $workerUrl
  secret_token = $secret
  allowed_updates = @('message', 'channel_post')
  drop_pending_updates = $true
} | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType 'application/json' -Body $payload
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo"
```

The `setWebhook` response should include `ok: true`. `getWebhookInfo` should show your `/telegram` URL. `drop_pending_updates` discards older updates; remove it or set it to false if you don't want that behavior.

## 5. Test

1. Send a fresh photo from another group member into the Telegram group.
2. Verify the image itself arrives at Slack `#testing_msg`.
3. Repeat with a PDF, an Excel workbook (.xls or .xlsx), and a Word document (.doc or .docx). Confirm each file arrives with its original filename and caption. Send a text-only message and a voice note; confirm the text appears with sender/group information and the voice note arrives as an audio file. Repeat with a video and a non-Office document.
4. See Cloudflare Workers → **Logs** for problems, and check Telegram's `getWebhookInfo.last_error_message` if Telegram cannot reach the webhook.

Switch from testing to production by updating `SLACK_CHANNEL_ID` and `TELEGRAM_CHAT_ID` with `wrangler secret put` and checking the Slack bot has been invited to the production channel.

## Details and limitations

- A request to `GET /` responds with a basic health message; `POST /telegram` requires Telegram's webhook secret header.
- Messages from other groups are ignored when `TELEGRAM_CHAT_ID` is set.
- Standard Telegram Bot API downloads are limited to **20 MB** per file. Larger files are skipped. This is Telegram's hosted Bot API download limit; increasing the code's size constant does not bypass it. Supporting larger files requires a separately hosted Telegram Bot API server and corresponding changes to this Worker. File bytes are temporarily buffered in Worker memory.
- Telegram retries webhook deliveries on HTTP 5xx responses; if an error occurs after a successful Slack upload, duplicates are possible. Production-grade deduplication can be added with Cloudflare KV/D1.
- Free Cloudflare Workers limits include 100,000 requests/day, 10 ms CPU/request, 128 MB memory. Network waiting time doesn't count as CPU time, but actual runs must be tested against limits.
- The Worker assumes trusted group membership and forwards text and all supported file/media attachments from the selected group. Review your organization's privacy and retention requirements.
- A Slack app with `files:write` and `chat:write` permissions is required. If upgrading an existing installation, add `chat:write` under OAuth & Permissions → Bot Token Scopes, reinstall the app to the workspace, and update the Cloudflare `SLACK_BOT_TOKEN` secret if Slack issues a new token. Missing `chat:write` causes text messages to fail with `missing_scope`. The legacy Slack `files.upload` API is **not** used.

Official references: [Telegram Bot API](https://core.telegram.org/bots/api), [Slack upload API](https://docs.slack.dev/reference/methods/files.getUploadURLExternal/), [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
