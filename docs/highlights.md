# Mint replay highlights on Heroku

Iona handles replay discovery, comment scanning, AI selection and Discord delivery in its existing Heroku worker dyno. Messages contain timestamped YouTube links and suggested cut boundaries for manual downloading. The active workflow does not download videos or upload files to Google Drive.

## Requirements

Configure these Heroku config vars on the same app that runs Iona:

| Variable | Purpose |
| --- | --- |
| `MONGO_DB` | Existing Iona database, including the existing `HighlightJob` collection |
| `YOUTUBE_API_KEY` | YouTube Data API v3 public metadata and comments |
| `YOUTUBE_DISCORD_CHANNEL_ID` | Existing notification destination |
| `OPENROUTER_API_KEY` | OpenRouter credential; migrate it from the retired Railway service |
| `OPENROUTER_MODEL` | Explicit model/router ID; free providers remain subject to availability and limits |
| `HIGHLIGHTS_ENABLED` | Set to `true` to enable discovery, selection and delivery |

Keep Iona's existing Discord and database configuration. No new npm dependency or extra Heroku dyno is needed. The existing Procfile remains `worker: node src/index.js`; do not replace the bot's start command with the highlights runner.

`HIGHLIGHTS_BENCHMARK_PASSED` is not required by the embedded Heroku scheduler. Existing `GOOGLE_*` credentials are unused. The old standalone runner/image and media/Drive helpers remain for compatibility, but Heroku does not launch the standalone runner or load the download helpers.

## Processing and delivery

- New completed Mint replays become eligible one hour after their actual end, subject to Iona discovering the available replay. Regular uploads and historical baseline videos are excluded. The fixed highlight source remains `UCcHHkJ98eSfa5aj0mdTwwLQ` even when notifications monitor other channels.
- `youtube:highlight-processing` runs every 15 minutes and processes at most one due job. It uses Iona's existing MongoDB connection and never disconnects the bot's shared database. A local overlap guard prevents overlapping ticks, while MongoDB leases protect job ownership across processes and restarts.
- Read one relevance-ordered page of up to 100 top-level comments. Replies are excluded. Combine timestamp-description pairs and remove exact duplicates. A terminal no-match result is not automatically scanned again.
- Retrieve duration from YouTube Data API metadata. Ask OpenRouter to select up to three supplied IDs. Validate JSON, known IDs, replay bounds and non-overlapping suggested windows before saving. Provider/validation failures have a three-attempt limit. Saved comments, duration and choices are reused after restarts.
- `youtube:highlight-links` runs every five minutes. It reads MongoDB and sends ready messages to Discord; this check does not call YouTube or OpenRouter. Selection failures are caught by Iona's scheduler, so normal replay notifications and ready-link delivery continue independently.
- Highlight messages have a plain replay title and numeric timestamp hyperlinks. Descriptions and emojis stay outside links. Suggested cuts span 30 seconds before and 90 seconds after the moment, clamped to replay duration.
- Delivery is marked only after Discord accepts the message. A crash between sending and saving delivery state can still duplicate a message.

## Migrate from Railway

1. Copy `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` into the Heroku app's config vars. Reuse the same MongoDB database and existing YouTube/Discord settings; do not create or clear a queue.
2. Stop the Railway highlights service's scheduled executions before enabling the Heroku processor. This prevents both hosts claiming different jobs concurrently during the transition. Leave its configuration available until Heroku is verified.
3. Deploy the updated Iona code to Heroku and set `HIGHLIGHTS_ENABLED=true`. Keep the normal worker dyno running. No benchmark flag is needed for this scheduler.
4. Look for `highlights-scheduler:enabled` and registrations for `youtube:highlight-processing` and `youtube:highlight-links`. Within the next 15 minutes, expect `job_completed` or a normal `no_due_jobs` result. Ready timestamp links are sent on a five-minute delivery tick.
5. Verify one pending/new replay completes selection and Discord delivery. Then retire Railway's service and unused credentials. Do not upgrade hosting automatically.

If credentials are missing, the processing tick fails with `MISSING_CONFIGURATION`, while the bot and separate delivery schedule remain operational. Correct the config vars and let the next scheduled tick retry.

## Manual preview and saved selections

The optional one-off command `node src/highlights/runner.js VIDEO_ID` can be run through Heroku's console/run facility for a completed public Mint replay. It owns only its one-off process's database connection; it does not replace or stop Iona's worker. A supplied ID bypasses the standalone automatic benchmark gate and may consume YouTube/model quota for new selections. Iona sends ready results on its regular delivery schedule.

Scheduled Heroku runs recover expired automatic jobs with saved `progress.clips`, including exhausted media jobs from the earlier clipping prototype. They preserve saved choices and avoid another model request. Active leases and already completed/notified jobs are left alone. For an old manual benchmark, rerun the one-off command with its video ID to recover that benchmark job. Earlier benchmarks may contain only one saved moment.

If no selection was saved and attempts were exhausted, investigate the API/model failure before explicitly resetting only that job. Normal replay discovery does not backfill historical baselines.

## Verification boundaries

CI mocks external services and tests embedded scheduling, overlap prevention, recovery, shared-connection safety, credential validation and independent delivery retries. Existing media/Drive helper tests remain, but the active workflow does not use those tools. Heroku deployment, live provider access, actual memory usage and Discord delivery must be verified on the running app. Reported process memory includes the full Iona worker, not just one highlight job.
