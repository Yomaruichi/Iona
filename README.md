# Iona

Iona is a modular Discord bot and a foundation for future backend and cloud integrations. The current deployment runs on ark, a self-hosted server, using Docker Compose and MongoDB.

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
test/                    Automated regression tests
.github/workflows/ci.yml GitHub Actions checks
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

Enable YouTube Data API v3 in a Google Cloud project and create an API key restricted to that API. Add the following to `.env`:

```dotenv
YOUTUBE_API_KEY=your-youtube-data-api-key
YOUTUBE_DISCORD_CHANNEL_ID=destination-discord-channel-id
YOUTUBE_CHANNEL_ID=UCcHHkJ98eSfa5aj0mdTwwLQ
```

The channel ID defaults to Mint Fantome's channel and can be changed. Both the API key and Discord destination are required to enable the scheduled job. The bot needs View Channel, Send Messages, and Embed Links permissions in the destination channel.

Every two hours, the module reads the channel feed and checks video metadata through the [YouTube Data API](https://developers.google.com/youtube/data/reference/rest/v3/videos). Regular uploads must be public and processed. Stream replays must also have an actual end time and no longer be marked live or upcoming. These metadata checks cannot guarantee playback availability in every region or for every viewer.

The first successful check silently records existing available videos. Streams that are still live or scheduled remain pending, including after they leave the feed. Subsequent checks announce newly available uploads and replays, oldest first. MongoDB preserves progress across restarts, retaining the latest 500 completed IDs plus unresolved pending IDs. Deleted or permanently unavailable pending videos currently require manual state cleanup. Changing the source or destination creates a new baseline.

Requests time out after 15 seconds, overlapping checks are skipped, and failed deliveries remain eligible for retry. A crash after Discord accepts a message but before MongoDB saves progress can produce a duplicate. Because discovery uses a limited recent feed, videos that enter and leave the feed entirely during extended downtime can be missed. Monitor API quota and polling errors in the bot logs. No public webhook or Cloudflare Worker is required.

After configuring `.env`, recreate the container with the deployment command below. Polls run at minute zero every two hours in the container's timezone; the first poll occurs at the next scheduled time. Notifications may arrive up to two hours after a video becomes available. Tests use simulated feeds and API responses and do not require a real key.

## Docker deployment

To send one clearly labeled simulated YouTube upload to the configured Discord channel:

```sh
docker compose exec iona node src/tools/simulateYoutube.js
```

Rebuild the container first if it does not yet contain this script. The simulation uses the real Discord connection and notification sender with fake feed/API responses and in-memory state. It uses no YouTube quota and makes no MongoDB changes. It verifies notification delivery and upload handling, but does not verify the API key, real feed access, or the scheduler.

The existing Compose service builds the production image, loads `.env`, exposes port 3000, restarts unless stopped, and rotates Docker logs. MongoDB is configured through `MONGO_DB`; Compose does not provision a database. When running in Docker, `localhost` refers to the bot container, so use a MongoDB address reachable from that container.

```sh
docker compose up -d --build
docker compose logs -f iona
```

The webhook server currently has no integration routes or signature verification. Future integrations need authentication before accepting external events.

## Tests and continuous integration

```sh
npm run check
npm test
```

GitHub Actions runs on pushes, pull requests, and manual dispatch. It installs dependencies from the lockfile, checks JavaScript syntax, and runs regression tests on Node.js 22 and 24. Tests cover dice command behavior, notification delivery, and command registration, including unchanged definitions and failed API calls. Discord and database interactions in these tests use mocks and require no credentials.

After the tests pass, CI validates Compose configuration, builds the production Docker image, and runs a container smoke check for installed dependencies and command/module loading. It does not connect to live Discord or MongoDB, deploy to ark, or publish an image. These checks catch build and covered behavior regressions; live service connectivity and complete bot startup still need deployment verification. Add regression tests alongside future features.

## Future plans

- Additional integrations such as GitHub notifications, Docker/Obsidian statistics, Moodle events, and X notifications.
- Private and public feature access controls so personal integrations can coexist with features available to other servers.
- A shared Cloudflare Worker webhook receiver, decoupled from the bot, that can serve multiple bots.
- Further development as a backend/cloud engineering showcase project.

These features are planned and have not yet been implemented.
