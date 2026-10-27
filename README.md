# Iona

Iona is a modular Discord bot and a foundation for future backend and cloud integrations, using MongoDB for persistent state. Hosting is being migrated from Docker Compose on ark, a self-hosted server, to a Heroku Basic worker dyno after intermittent networking issues. Docker remains available for self-hosted deployment.

## Current functionality

- `/dice pieces sides` rolls dice and replies with their total.
- Replies `hi` when a user sends `hello`.
- Optional YouTube notifications for regular uploads and completed stream replays, with Mint Fantome's channel as the default.
- Automatically loads slash commands and registers them globally with Discord when their definitions change. A hash stored in MongoDB avoids unnecessary registration.

The code also contains shared infrastructure for module loading, Express webhook routes, cron jobs, embed notifications, and MongoDB module state. The YouTube module uses scheduled polling; module scope labels are informational and private/public access controls have not been implemented.

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

Enable YouTube Data API v3 in a Google Cloud project and create an API key restricted to that API. OAuth is not required for the public video metadata used by this integration. Add the following to `.env` locally, or to Heroku Config Vars when hosted:

```dotenv
YOUTUBE_API_KEY=your-youtube-data-api-key
YOUTUBE_DISCORD_CHANNEL_ID=destination-discord-channel-id
YOUTUBE_CHANNEL_ID=UCcHHkJ98eSfa5aj0mdTwwLQ
```

The channel ID defaults to Mint Fantome's channel and can be changed. Both the API key and Discord destination are required to enable the scheduled job. The bot needs View Channel, Send Messages, and Embed Links permissions in the destination channel.

Every hour, the module reads the channel feed and checks video metadata through the [YouTube Data API](https://developers.google.com/youtube/data/reference/rest/v3/videos). Regular uploads must be public and processed. Stream replays must also have an actual end time and no longer be marked live or upcoming. These metadata checks cannot guarantee playback availability in every region or for every viewer.

Discovery reads the feed first. If it contains no video IDs, the module falls back to the channel's uploads playlist through `channels.list` and `playlistItems.list`, caching the playlist ID in MongoDB. No search API is used. Metadata checks use `videos.list` with up to 50 candidate IDs per batch. Each of these Data API calls costs one quota unit. With the fallback active, each hourly check uses one discovery call plus any metadata batches (typically 24–48 units per day, plus initial channel lookup). Logs identify each requested API endpoint and summarize video counts and API requests.

The first successful check silently records existing available videos. Streams that are still live or scheduled remain pending, including after they leave the feed. Subsequent checks announce newly available uploads and replays, oldest first. MongoDB preserves progress across restarts, retaining the latest 500 completed IDs plus unresolved pending IDs. Deleted or permanently unavailable pending videos currently require manual state cleanup. Changing the source or destination creates a new baseline.

Requests time out after 15 seconds, overlapping checks are skipped, and failed deliveries remain eligible for retry. A crash after Discord accepts a message but before MongoDB saves progress can produce a duplicate. Because discovery uses a limited recent feed, videos that enter and leave the feed entirely during extended downtime can be missed. Monitor API quota and polling errors in the bot logs. No public webhook or Cloudflare Worker is required.

Polls run at minute zero every hour in the runtime's timezone; the first poll occurs at the next scheduled time. Notifications may arrive up to an hour after availability under normal operation; failed checks delay delivery further. Restart the hosted process or recreate the Docker container after changing configuration.

## Heroku deployment

The current hosting target is one Basic worker dyno. Discord connections and YouTube polling use outbound network access, so public HTTP routing is not required. The intended process declaration is:

```procfile
worker: node src/index.js
```

The checked-in `Procfile` currently declares `web: node src/index.js`; change that declaration to `worker` before using this worker deployment configuration. Run only one bot process to avoid duplicate notifications.

In the Heroku dashboard, open **Settings → Reveal Config Vars** and configure:

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application ID |
| `MONGO_DB` | MongoDB URI reachable from Heroku |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key; enables monitoring with a destination |
| `YOUTUBE_DISCORD_CHANNEL_ID` | Destination Discord channel for notifications |
| `YOUTUBE_CHANNEL_ID` | Optional source channel override; defaults to Mint Fantome |

The local `.env` file is not deployed automatically. A missing `MONGO_DB` causes startup to fail with an undefined URI error. A database on `localhost` or an ark-only LAN address is not reachable from Heroku; use an externally reachable database and configure its network access for the hosted application.

After deploying, enable one worker and disable the web process if it exists. Check startup logs for database connectivity, Discord login, and the registered YouTube schedule. Once the hosted instance is verified, stop the ark instance.

The Express listener uses `PORT`, then `WEBHOOK_PORT`, then `3000`. Heroku assigns `PORT` for a web dyno. A worker can run the listener internally, but Heroku does not route public HTTP requests to workers. Incoming webhooks will require a web process or separate receiver. No integration routes or signature verification are currently implemented.

## Simulate a YouTube notification

To verify real discovery and API access from Heroku's Run Console without sending Discord messages or changing MongoDB state, run:

```sh
node src/tools/checkYoutube.js
```

Unlike the simulation below, this diagnostic uses real YouTube requests and consumes their normal quota. An old empty `seen`/`pending` record without an initialization flag is quietly baselined on the next successful production check, preventing a flood of historical notifications.

The simulation sends one clearly labeled test embed to the configured Discord destination. It uses the real Discord connection and notification sender with fake feed/API responses and in-memory state. It uses no YouTube quota and makes no MongoDB changes. It verifies notification delivery and upload handling, but does not verify the API key, real feed access, or scheduler.

On Heroku, select **More → Run console** and run:

```sh
node src/tools/simulateYoutube.js
```

Alternatively, use the CLI:

```sh
heroku run "node src/tools/simulateYoutube.js" --app YOUR_APP_NAME
```

The one-off dyno uses the app's Config Vars and is billed separately for its runtime. The script requires `DISCORD_TOKEN` and `YOUTUBE_DISCORD_CHANNEL_ID`.

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

- Additional integrations such as GitHub notifications, Docker/Obsidian statistics, Moodle events, and X notifications.
- Private and public feature access controls so personal integrations can coexist with features available to other servers.
- A shared Cloudflare Worker webhook receiver, decoupled from the bot, that can serve multiple bots.
- Further development as a backend/cloud engineering showcase project.

These features are planned and have not yet been implemented.
