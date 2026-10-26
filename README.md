# Iona

Iona is a modular Discord bot and a foundation for future backend and cloud integrations. The current deployment runs on ark, a self-hosted server, using Docker Compose and MongoDB.

## Current functionality

- `/dice pieces sides` rolls dice and replies with their total.
- Replies `hi` when a user sends `hello`.
- Automatically loads slash commands and registers them globally with Discord when their definitions change. A hash stored in MongoDB avoids unnecessary registration.

The code also contains shared scaffolding for module loading, Express webhook routes, cron jobs, embed notifications, and MongoDB module state. `src/modules` currently has no integrations. Module scope labels are informational; private/public access controls have not been implemented.

## Stack and layout

Node.js (the Docker image uses Node 22), CommonJS, discord.js v14, Express, Mongoose/MongoDB, and node-cron.

```text
src/index.js              Bot startup, command loading, and Discord events
src/commands/            Slash commands and dice helpers
src/core/                Database, modules, webhooks, scheduling, notifications
src/modules/             Future integrations
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

## Docker deployment

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

- Integrations such as GitHub notifications, Docker/Obsidian statistics, Moodle events, and YouTube upload notifications.
- Private and public feature access controls so personal integrations can coexist with features available to other servers.
- A shared Cloudflare Worker webhook receiver, decoupled from the bot, that can serve multiple bots.
- Further development as a backend/cloud engineering showcase project.

These features are planned and have not yet been implemented.
