# Mint replay highlights

This optional prototype runs alongside Iona. Iona stays on Heroku; a separate Railway cron service handles comment discovery, selection, video extraction, and Drive uploads. No service is deployed or enabled by installing the code.

## Behavior

- Only newly announced, completed Mint streams create automatic jobs. Regular uploads and initial quiet baselines do not. The fixed source is `UCcHHkJ98eSfa5aj0mdTwwLQ` even when other YouTube channels are monitored.
- Each replay has a unique MongoDB `HighlightJob` record. Jobs become due one hour after the actual end time, subject to Iona first detecting an available replay. Each Railway run processes at most one due job and exits.
- One relevance-ordered page of at most 100 top-level comments is stored. No second page or replies are fetched. Timestamp-description pairs from all comments are combined and exact duplicates removed. No matches is terminal; transport/API failures receive at most three processing attempts.
- OpenRouter receives only timestamp descriptions and replay metadata. It chooses up to three supplied IDs, favoring funny or memorable moments. Invented IDs, invalid bounds, overlapping windows, and inputs above 100,000 characters are rejected. Valid selections persist before extraction.
- Each window spans 30 seconds before and 90 seconds after the selected time, clamped to replay duration. Sequential yt-dlp section downloads and FFmpeg encoding produce MP4 clips at up to 720p. The worker does not intentionally fall back to downloading the full replay or bypass access restrictions.
- Google Drive uploads use resumable chunks and deterministic clip properties for recovery. Files inherit the destination folder's permissions; no public permissions are added. The worker rejects folders with anyone/domain access. A private folder must be selected by the operator; explicitly shared users can still access it.
- Uploaded IDs persist individually. A renewable two-minute lease protects processing; expired leases are reclaimable. Retries preserve comments, selections, and uploaded IDs. Temporary files are removed after every attempted clip.
- Iona polls completed jobs every five minutes and posts private Drive links to the replay's notification destination. A crash after a Discord send and before saving delivery can still duplicate the announcement.

## Configuration

Keep `HIGHLIGHTS_ENABLED` unset or `false` until benchmarking passes. Normal YouTube notifications do not require highlight credentials.

Railway variables:

| Variable | Purpose |
| --- | --- |
| `MONGO_DB` | Same reachable database as Iona |
| `YOUTUBE_API_KEY` | Public metadata and comments |
| `YOUTUBE_DISCORD_CHANNEL_ID` | Destination recorded for manual benchmark jobs |
| `OPENROUTER_API_KEY` | Model API credential |
| `OPENROUTER_MODEL` | Explicit model identifier; no default model is selected |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client credentials |
| `GOOGLE_REFRESH_TOKEN` | Offline OAuth grant for the Drive account |
| `GOOGLE_DRIVE_FOLDER_ID` | Private output folder owned by that account |
| `HIGHLIGHTS_ENABLED` | Enables automatic due-job processing when `true` |
| `HIGHLIGHTS_BENCHMARK_PASSED` | Operator approval after reviewing benchmark resource use and cost |

Enable Google Drive API and obtain an offline OAuth refresh token for the upload account with the `drive` scope (folder permission checks and recovery queries require access). Store it only in hosting secrets. For an OAuth app in testing, check Google's refresh-token lifetime restrictions before relying on unattended runs. The worker adds files but does not create or change folder sharing.

Set Railway's configuration-file path to `railway.highlights.json`. It builds `Dockerfile.highlights`, runs every 15 minutes in UTC, and uses restart policy `NEVER`. Set a 512 MB memory limit and review the account's available free credit, usage alerts, and resource limits. Never enable automatic upgrades as part of this prototype.

## Benchmark before enabling automation

1. Deploy the separate worker with automatic highlights disabled and the credentials above configured. Do not modify Iona's normal start command.
2. Manually run `node src/highlights/runner.js VIDEO_ID` in the Railway environment for a completed public Mint replay containing timestamp comments. This bypasses the delay, uses the real comment/AI pipeline, and processes only the first chosen clip. It uses quota, model credit, and Drive storage. A unique existing job is not overwritten; use another replay for a separate benchmark.
3. Check `HighlightJob` status/progress, the private uploaded MP4, runtime, `run_metrics` cgroup peak memory (includes child processes where supported), and Railway billing usage. Node's own RSS is also logged but does not represent FFmpeg memory. Cost is read from Railway's dashboard, not inferred from elapsed time.
4. Confirm the runtime is under 20 minutes and peak memory below 512 MB with headroom. Check source availability and output quality. Free-tier viability remains unverified until measured; a failed benchmark does not trigger a paid upgrade.
5. Only after review, set `HIGHLIGHTS_ENABLED=true` and `HIGHLIGHTS_BENCHMARK_PASSED=true` on Railway. Set `HIGHLIGHTS_ENABLED=true` on Heroku to enable replay enqueueing and completed-link delivery. Existing historical baselines are not backfilled.

## Operational limits

The 20-minute deadline covers one processing attempt; leases permit up to three attempts. A blocked source or insufficient resources is logged as a failed job attempt, with progress retained. Out-of-memory termination may prevent cleanup, but Railway's disposable container storage and lease recovery handle subsequent runs. The downloader and FFmpeg share a process group on Linux so the deadline kills descendants as well.

Clip output is capped at 200 MB after encoding. Source section bitrate and temporary storage can still be substantial; the real benchmark is mandatory. Drive sessions restart after failed chunks, while completed uploads are found by clip identity to avoid duplication. OAuth token expiry or account limits can require operator intervention. Removing sharing from a previously shared folder does not automatically revoke separate permissions on existing files.

CI uses mocks for external APIs and creates a tiny local video fixture for FFmpeg tests. It also builds the separate image and confirms that its unconfigured startup exits without paid requests. Real downloads, OAuth, Railway cost, and live Drive delivery are not exercised in CI.
