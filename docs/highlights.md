# Mint replay highlights

Iona posts AI-selected replay moments as timestamped YouTube links in the existing Discord notification channel. People can review the moments and manually download or edit source material through a permitted workflow. The active worker does not download video or upload files to Google Drive.

## Behavior

- Iona stays on Heroku. A separate Railway service runs every 15 minutes, processes at most one due job, and exits. Iona checks for completed suggestions every five minutes and sends them to the job's recorded Discord destination.
- Only newly announced, completed Mint streams create automatic jobs. Regular uploads and initial quiet baselines are excluded. The source remains `UCcHHkJ98eSfa5aj0mdTwwLQ` even when Iona monitors other channels.
- Each replay has a unique MongoDB `HighlightJob`. A scan becomes eligible one hour after the actual stream end, subject to Iona first detecting an available replay.
- One relevance-ordered page of at most 100 top-level comments is stored. Replies are excluded. Timestamp-description pairs from all comments are combined and exact duplicates removed. No usable timestamps is a terminal result; API failures receive up to three attempts.
- OpenRouter ranks the descriptions and replay metadata, selecting up to three supplied IDs. It does not watch the video. JSON responses are validated; invented IDs, invalid bounds and overlapping suggested windows are rejected.
- Replay duration comes from YouTube Data API `videos.list` with `contentDetails`. No video-stream request, yt-dlp, FFmpeg, Google OAuth or Drive credentials are required by the worker.
- Discord messages include the replay title, each selected description, a link to the actual moment, and suggested cut boundaries spanning 30 seconds before and 90 seconds after the moment, clamped to replay duration.
- MongoDB stores comments, duration, selections and delivery progress. A renewable two-minute processing lease permits restart recovery. Discord delivery is marked only after a successful send; a crash between sending and saving can still duplicate a message.

## Configuration

Keep the feature disabled until a manual preview has been reviewed. Normal replay notifications remain independent.

Railway variables:

| Variable | Purpose |
| --- | --- |
| `MONGO_DB` | Same reachable database as Iona |
| `YOUTUBE_API_KEY` | Public replay metadata and comments |
| `YOUTUBE_DISCORD_CHANNEL_ID` | Destination recorded for manually supplied replays |
| `OPENROUTER_API_KEY` | Model API credential |
| `OPENROUTER_MODEL` | Explicit model or router ID; free endpoints remain subject to availability and rate limits |
| `HIGHLIGHTS_ENABLED` | Enables automatic due-job processing when `true` |
| `HIGHLIGHTS_BENCHMARK_PASSED` | Retained approval gate after reviewing the timestamp-link preview, resource use and cost |

Heroku requires `HIGHLIGHTS_ENABLED=true` to enqueue new replays and deliver completed timestamp suggestions. It uses Iona's existing Discord connection; no Discord token is required on Railway.

Existing `GOOGLE_*` variables are unused by this workflow and may be removed from the highlights service. The older Drive/media helpers remain in the repository but are not loaded by the worker.

Configure Railway directly with Dockerfile path `Dockerfile.highlights` (or `RAILWAY_DOCKERFILE_PATH=Dockerfile.highlights`), start command `node src/highlights/runner.js`, cron `*/15 * * * *`, and restart policy `NEVER`. The image now needs only Node.js and production npm dependencies. The legacy `railway.highlights.json` is a reference for services already using config files; new services should use Railway's service settings. Keep the existing memory limit and review actual usage before changing hosting plans.

## Manual preview and rollout

1. Deploy the updated code to both Heroku and Railway. Keep automatic Railway processing disabled initially.
2. Enable `HIGHLIGHTS_ENABLED=true` on Heroku so Iona can deliver completed selections from MongoDB.
3. Run `node src/highlights/runner.js VIDEO_ID` on Railway for a completed public Mint replay. For a stopped cron container, temporarily set this as the custom start command and deploy, then restore `node src/highlights/runner.js` after the preview. The video argument bypasses the delay and automatic approval gate; it still consumes API quota and potentially model credit for new selections.
4. Check worker logs for completion and wait up to five minutes for Iona to post the timestamp links. Verify descriptions, link positions, cut boundaries, runtime, memory and Railway/OpenRouter usage. Mocked tests do not prove live delivery.
5. After review, set `HIGHLIGHTS_ENABLED=true` and `HIGHLIGHTS_BENCHMARK_PASSED=true` on Railway for automatic selection. Existing baselines are not backfilled.

## Recovering selections from the earlier clipping prototype

On each worker run, expired jobs with saved `progress.clips` are marked completed for timestamp-link delivery. This includes failed media jobs whose three attempts were exhausted. Saved comments, choices and suggested cut windows are preserved; the worker does not repeat AI spending or extraction. Active processing leases and already completed/notified jobs are left alone.

For an earlier manual benchmark, rerun with the same video ID to recover that benchmark job. Automatic runs recover automatic jobs. A saved benchmark might contain only one moment because the earlier clipping benchmark limited its selection to one clip. No MongoDB reset is needed when a valid saved selection exists.

If no selection was saved and attempts were exhausted, investigate the API/model failure before explicitly resetting only that job's status and attempts. Successful pages and metadata remain reusable.

## Verification boundaries

CI mocks YouTube, OpenRouter, MongoDB and Discord. Tests cover timestamp selection, API duration, bounded message formatting, recovery, duplicate prevention and delivery retries. Existing media/Drive helper tests are retained, including a generated local FFmpeg fixture, but those tools are not included in the active highlights image. Live Discord delivery, Railway runtime and provider availability require a deployed preview.
