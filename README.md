# Iona

Iona is a modular Discord bot and a foundation for future backend and cloud integrations, using MongoDB for persistent state. Hosting is being migrated from Docker Compose on ark, a self-hosted server, to a Heroku Basic worker dyno after intermittent networking issues. Docker remains available for self-hosted deployment.

## Current functionality

- `/dice pieces sides` rolls dice and replies with their total.
- Replies `hi` when a user sends `hello`.
- Optional YouTube notifications for regular uploads and completed stream replays from multiple channels, with Mint Fantome as the default source.
- Automatically loads slash commands and registers them globally with Discord when their definitions change. A hash stored in MongoDB avoids unnecessary registration.

The code also contains shared infrastructure for module loading, Express webhook routes, cron jobs, text/embed notifications, and MongoDB module state. The YouTube module uses scheduled polling; module scope labels are informational and private/public access controls have not been implemented.

## Stack and layout

Node.js (the Docker image uses Node 22), CommonJS, discord.js v14, Express, Mongoose/MongoDB, and node-cron.

```text
src/index.js              Bot startup, command loading, and Discord events
src/commands/            Slash commands and dice helpers
src/core/                Database, modules, webhooks, scheduling, notifications
src/modules/             Platform integrations
src/tools/               Manual notification simulation
test/                    Automated regression tests
.github/workflows/ci.yml GitHub Actions checks
Procfile                 Heroku process declaration
```

## Local setup

Install Node.js 22 or 24 and provide a reachable MongoDB instance. Create a Discord application and bot, invite it with the `bot` and `applications.commands` scopes, and enable the Message Content and Server Members privileged intents used by the current client.

Create a local `.env` file:

```dotenv
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-discord-application-id
MONGO_DB=mongodb://localhost:27017/iona
WEBHOOK_PORT=3000
```

Keep credentials out of version control. Then run:

```sh
npm ci
npm start
```

Startup connects to MongoDB before logging into Discord. Once ready, it loads modules, starts the webhook server, and registers changed global slash commands.

## YouTube upload notifications

Notifications show the video title as a Markdown hyperlink beside the status, for example `Stream replay is available. [Stream title](https://www.youtube.com/watch?v=VIDEO_ID)`. No custom embed or preview-suppression flag is sent; preview rendering depends on Discord's behavior and settings. Regular uploads use `New video uploaded.` and manual tests add `[TEST]`. Formatting characters in titles are escaped to preserve the link.

Enable YouTube Data API v3 in a Google Cloud project and create an API key restricted to that API. OAuth is not required for the public video metadata used by this integration. Add the following to `.env` locally, or to Heroku Config Vars when hosted:

```dotenv
YOUTUBE_API_KEY=your-youtube-data-api-key
YOUTUBE_DISCORD_CHANNEL_ID=destination-discord-channel-id
YOUTUBE_CHANNEL_ID=UCcHHkJ98eSfa5aj0mdTwwLQ
```

For multiple YouTube channels, set `YOUTUBE_CHANNEL_IDS` to a comma-separated list in `.env` or Heroku Config Vars:

```dotenv
YOUTUBE_CHANNEL_IDS=UCcHHkJ98eSfa5aj0mdTwwLQ,ANOTHER_YOUTUBE_CHANNEL_ID
```

Replace the second value with the creator's actual channel ID. `YOUTUBE_CHANNEL_IDS` takes precedence over the existing `YOUTUBE_CHANNEL_ID`. Whitespace and duplicate IDs are removed. When neither variable is set, Mint Fantome remains the default. All configured sources post to `YOUTUBE_DISCORD_CHANNEL_ID`; per-source Discord destinations are not configured in this version.

Both the API key and Discord destination are required to enable monitoring. Each source has a separate hourly job and MongoDB record using the existing `sourceChannelId:destinationChannelId` key, so existing state is preserved. New sources receive their own quiet baseline. One source's failure does not stop the others. The bot needs View Channel, Send Messages, and Embed Links permissions in the destination channel.

Every hour, the module reads the channel feed and checks video metadata through the [YouTube Data API](https://developers.google.com/youtube/data/reference/rest/v3/videos). Regular uploads must be public and processed. Stream replays must also have an actual end time and no longer be marked live or upcoming. These metadata checks cannot guarantee playback availability in every region or for every viewer.

Discovery reads the feed first. If it contains no video IDs, the module falls back to the channel's uploads playlist through `channels.list` and `playlistItems.list`, caching the playlist ID in MongoDB. No search API is used. Metadata checks use `videos.list` with up to 50 candidate IDs per batch. Each of these Data API calls costs one quota unit. With the fallback active, each source's hourly check uses one discovery call plus any metadata batches (typically 24–48 units per day per source, plus initial channel lookup). All sources share the API project's quota. Logs identify requested endpoints, and job labels and check summaries identify the source channel.

The first successful check silently records existing available videos. Streams that are still live or scheduled remain pending, including after they leave the feed. Subsequent checks announce newly available uploads and replays, oldest first. MongoDB preserves progress across restarts, retaining the latest 500 completed IDs plus unresolved pending IDs. Deleted or permanently unavailable pending videos currently require manual state cleanup. Changing the source or destination creates a new baseline.

Requests time out after 15 seconds, overlapping checks are skipped, and failed deliveries remain eligible for retry. A crash after Discord accepts a message but before MongoDB saves progress can produce a duplicate. Because discovery uses a limited recent feed, videos that enter and leave the feed entirely during extended downtime can be missed. Monitor API quota and polling errors in the bot logs. No public webhook or Cloudflare Worker is required.

Polls run at minute zero every hour in the runtime's timezone; the first poll occurs at the next scheduled time. Notifications may arrive up to an hour after availability under normal operation; failed checks delay delivery further. Restart the hosted process or recreate the Docker container after changing configuration.

## Heroku deployment

The current hosting target is one Basic worker dyno. Discord connections and YouTube polling use outbound network access, so public HTTP routing is not required. The intended process declaration is:

```procfile
worker: node src/index.js
```

Run only one bot process to avoid duplicate notifications.

In the Heroku dashboard, open **Settings → Reveal Config Vars** and configure:

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application ID |
| `MONGO_DB` | MongoDB URI reachable from Heroku |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key; enables monitoring with a destination |
| `YOUTUBE_DISCORD_CHANNEL_ID` | Destination Discord channel for notifications |
| `YOUTUBE_CHANNEL_ID` | Optional source channel override; defaults to Mint Fantome |
| `YOUTUBE_CHANNEL_IDS` | Optional comma-separated source IDs; overrides `YOUTUBE_CHANNEL_ID` |

The local `.env` file is not deployed automatically. A missing `MONGO_DB` causes startup to fail with an undefined URI error. A database on `localhost` or an ark-only LAN address is not reachable from Heroku; use an externally reachable database and configure its network access for the hosted application.

After deploying, enable one worker and disable the web process if it exists. Check startup logs for database connectivity, Discord login, and the registered YouTube schedule. Once the hosted instance is verified, stop the ark instance.

The Express listener uses `PORT`, then `WEBHOOK_PORT`, then `3000`. Heroku assigns `PORT` for a web dyno. A worker can run the listener internally, but Heroku does not route public HTTP requests to workers. Incoming webhooks will require a web process or separate receiver. No integration routes or signature verification are currently implemented.

## Simulate a YouTube notification

To verify real discovery and API access from Heroku's Run Console without sending Discord messages or changing MongoDB state, run:

```sh
node src/tools/checkYoutube.js
```

Both manual tools use the first configured source by default. To inspect another configured source, pass its channel ID as the first argument:

```sh
node src/tools/checkYoutube.js ANOTHER_YOUTUBE_CHANNEL_ID
node src/tools/simulateYoutube.js ANOTHER_YOUTUBE_CHANNEL_ID
```

This diagnostic uses real YouTube requests and consumes their normal quota. An old empty `seen`/`pending` record without an initialization flag is quietly baselined on the next successful production check, preventing a flood of historical notifications.

The manual test fetches real data from YouTube and sends one `[TEST]` text notification linking to the latest available upload or completed stream replay among the channel's 50 most recent uploads. It uses the configured channel (Mint Fantome by default), skips live/upcoming or unavailable videos, and ranks replays by completion time and regular uploads by publication time. It makes three Data API requests on the normal path (three quota units) and sends nothing if no eligible video exists. It makes no MongoDB reads or writes, so it can be repeated without affecting normal notification tracking. It verifies API access and Discord delivery, but does not verify the hourly scheduler or feed endpoint.

On Heroku, select **More → Run console** and run:

```sh
node src/tools/simulateYoutube.js
```

Alternatively, use the CLI:

```sh
heroku run "node src/tools/simulateYoutube.js" --app YOUR_APP_NAME
```

The one-off dyno uses the app's Config Vars and is billed separately for its runtime. The script requires `DISCORD_TOKEN`, `YOUTUBE_DISCORD_CHANNEL_ID`, and `YOUTUBE_API_KEY`.

## Docker deployment

To run the simulation in Docker:

```sh
docker compose exec iona node src/tools/simulateYoutube.js
```

Rebuild the container first if it does not yet contain this script.

The existing Compose service builds the production image, loads `.env`, exposes port 3000, restarts unless stopped, and rotates Docker logs. MongoDB is configured through `MONGO_DB`; Compose does not provision a database. When running in Docker, `localhost` refers to the bot container, so use a MongoDB address reachable from that container.

```sh
docker compose up -d --build
docker compose logs -f iona
```

## Troubleshooting connectivity

### Process logs

Application logs use `[TRACE]`, `[DEBUG]`, `[INFO]`, `[WARN]`, `[ERROR]`, and `[CRITICAL]`, followed by a UTC timestamp, component/event, and safe context fields. Each logging call has an adjacent specification describing its trigger and fields. Standard console output remains compatible with Heroku logs and its Datadog drain; no agent is required for these messages.

`LOG_LEVEL` defaults to `INFO`. Set it to `DEBUG` for database state reads/writes and transport details, or `TRACE` for the most verbose level. `WARN` describes recoverable anomalies, `ERROR` describes a failed operation, and `CRITICAL` describes a service-blocking failure. Credentials, request URLs, raw error messages, and stored payloads are excluded or redacted.

Startup includes a process ID; database events distinguish `connected`, `disconnected`, and `reconnected`. YouTube checks report API request attempts and returned counts, baseline saves, deferred videos, deliveries, and no-work runs. A failed request logs its safe classification (for example `EAI_AGAIN` or `HTTP_403`) and the next action. Success events appear only after their corresponding operation completes.

`getaddrinfo EAI_AGAIN` indicates a DNS lookup failure before the request reaches Discord or YouTube. It is not an OAuth, channel permission, or API quota error. Check resolution and HTTPS connectivity from inside the deployed environment.

The scheduler catches failed YouTube checks and tries again at the next scheduled time. Repeated `Connected to the database` messages can indicate Mongoose reconnecting; they do not by themselves prove a process restart. Correlate timestamped application logs with hosting restart events before diagnosing a crash.

During the ark deployment, using its local DNS resolver helped a Discord simulation succeed, but later failures showed that connectivity was still intermittent. Any DNS override should match the deployment network; an ark LAN resolver is not a portable hosting configuration.

## Tests and continuous integration

```sh
npm run check
npm test
```

GitHub Actions runs on pushes, pull requests, and manual dispatch. It installs dependencies from the lockfile, checks JavaScript syntax, and runs regression tests on Node.js 22 and 24. Tests cover dice commands, notifications, command registration, and YouTube monitoring: first-run baselining, deduplication, finished streams, delivery retries, request failures, ordering, and overlapping checks. Discord, database, and YouTube interactions in these tests use mocks and require no credentials.

After the tests pass, CI validates Compose configuration, builds the production Docker image, and runs a container smoke check for installed dependencies and command/module loading. It does not connect to live services, deploy the bot, or publish an image. These checks catch build and covered behavior regressions; live service connectivity and complete bot startup still need deployment verification. Add regression tests alongside future features.

## Future plans

An optional [Mint replay highlights workflow](docs/highlights.md) is implemented behind `HIGHLIGHTS_ENABLED`. A separate Railway cron worker scans timestamp comments and asks OpenRouter to select up to three moments. Iona posts timestamped YouTube links and suggested cut boundaries in Discord for manual downloading. The worker uses YouTube Data API metadata; video extraction and Google Drive uploads are no longer part of the active workflow. Automatic processing requires a reviewed preview and explicit activation; live delivery and hosting usage must be verified after deployment.

- Additional integrations such as GitHub notifications, Docker/Obsidian statistics, Moodle events, and X notifications.
- Private and public feature access controls so personal integrations can coexist with features available to other servers.
- A shared Cloudflare Worker webhook receiver, decoupled from the bot, that can serve multiple bots.
- Further development as a backend/cloud engineering showcase project.

These features are planned and have not yet been implemented.
