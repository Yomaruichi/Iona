const { escapeMarkdown } = require('discord.js');

function titleParts(value) {
    const emojis = [];
    const text = [];
    // Segment complete visible characters so joined emoji, skin tones, flags and keycaps stay intact.
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) {
        if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment)) emojis.push(segment);
        else text.push(segment);
    }
    return { text: text.join('').replace(/\s+/g, ' ').trim() || 'YouTube video', emojis: emojis.join(' ') };
}

function uploadNotification(video, { test = false } = {}) {
    const status = video.liveStreamingDetails ? 'Stream replay is available.' : 'New video uploaded.';
    const prefix = test ? '[TEST] ' : '';
    const parts = titleParts(video.snippet.title);
    // Escape creator text inside the link while keeping emoji outside Discord's link label.
    const title = escapeMarkdown(parts.text).replace(/[\[\]]/g, '\\$&');
    const suffix = parts.emojis ? ` ${parts.emojis}` : '';
    return { content: `${prefix}${status} [${title}](https://www.youtube.com/watch?v=${video.id})${suffix}` };
}

module.exports = { uploadNotification };
