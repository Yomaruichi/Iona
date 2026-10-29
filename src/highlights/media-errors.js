const failures = [
    { pattern: /sign in to confirm you[’']?re not a bot/i, code: 'MEDIA_BOT_CHECK' },
    { pattern: /sign in|login required|members.only|private video|age.restricted/i, code: 'MEDIA_AUTH_REQUIRED' },
    { pattern: /HTTP (?:Error )?429|too many requests/i, code: 'MEDIA_RATE_LIMITED' },
    { pattern: /HTTP (?:Error )?403|403 forbidden/i, code: 'MEDIA_ACCESS_DENIED' },
    { pattern: /requested format is not available|no video formats found/i, code: 'MEDIA_FORMAT_UNAVAILABLE' },
    { pattern: /no supported javascript runtime|challenge solving failed|signature extraction failed/i, code: 'MEDIA_JS_CHALLENGE_FAILED' },
    { pattern: /ffmpeg.*(?:not installed|not found)|ffprobe.*(?:not installed|not found)/i, code: 'MEDIA_FFMPEG_MISSING' },
    { pattern: /no space left on device|disk quota exceeded/i, code: 'MEDIA_DISK_FULL' },
    { pattern: /temporary failure in name resolution|name or service not known|timed out|connection reset/i, code: 'MEDIA_NETWORK_FAILURE' },
    { pattern: /video unavailable|not available in your country|has been removed/i, code: 'MEDIA_SOURCE_UNAVAILABLE' },
    { pattern: /unrecognized (?:arguments|option)|no such option|option .* not found/i, code: 'MEDIA_UNSUPPORTED_OPTION' },
    { pattern: /no such file or directory/i, code: 'MEDIA_FILE_MISSING' },
];

function mediaError(exitCode, diagnostics) {
    const failure = failures.find(item => item.pattern.test(diagnostics));
    const error = new Error('Media tool failed');
    error.code = failure?.code || `MEDIA_EXIT_${exitCode}`;
    return error;
}

function toolName(command) {
    if (['yt-dlp', 'ffmpeg', 'ffprobe'].includes(command)) return command;
    return 'subprocess';
}

module.exports = { mediaError, toolName };
