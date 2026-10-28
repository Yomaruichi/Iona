const { escapeMarkdown } = require('discord.js');

function uploadNotification(video, { test = false } = {}) {
    const status = video.liveStreamingDetails ? 'Stream replay is available.' : 'New video uploaded.';
    const prefix = test ? '[TEST] ' : '';
    // Escape title formatting and link delimiters so creator-supplied text stays inside the link label.
    const title = escapeMarkdown(video.snippet.title.replace(/[\r\n]+/g, ' ')).replace(/[\[\]]/g, '\\$&');
    return { content: `${prefix}${status} [${title}](https://www.youtube.com/watch?v=${video.id})` };
}

module.exports = { uploadNotification };
