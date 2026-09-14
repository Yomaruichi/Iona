const express = require('express');
const app = express();

app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; } // needed for HMAC verification later
}));

function registerRoute(path, middleware, handler) {
    app.post(path, ...middleware, handler);
    console.log(`Webhook route registered: POST ${path}`);
}

function start(port = process.env.WEBHOOK_PORT || 3000) {
    app.listen(port, () => console.log(`Webhook server listening on :${port}`));
}

module.exports = { registerRoute, start };