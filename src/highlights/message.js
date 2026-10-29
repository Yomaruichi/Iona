function timestamp(seconds) {
    const value = Math.floor(seconds);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor(value % 3600 / 60);
    const tail = String(value % 60).padStart(2, '0');
    if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${tail}`;
    return `${minutes}:${tail}`;
}

function label(value, limit) {
    return String(value).replace(/\s+/g, ' ').slice(0, limit).replace(/([\\`*_{}\[\]()<>|~])/g, '\\$1');
}

function highlightMessage(job) {
    const url = `https://www.youtube.com/watch?v=${encodeURIComponent(job.videoId)}`;
    const moments = job.progress.clips.slice(0, 3).map((clip, index) => {
        const link = `[${timestamp(clip.seconds)}](${url}&t=${Math.floor(clip.seconds)}s)`;
        return `${index + 1}. ${link} — ${label(clip.description, 150)}\nSuggested cut: ${timestamp(clip.start)}–${timestamp(clip.end)}`;
    });
    return { content: `Replay highlights for manual download\n${label(job.title, 100)}\n\n${moments.join('\n\n')}` };
}

module.exports = { highlightMessage };
