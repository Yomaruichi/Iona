const mongoose = require('mongoose');
const { createLogger, safeError } = require('./logger');
const log = createLogger('db');
let listenersAttached = false;

async function connect() {
    if (!listenersAttached) {
        listenersAttached = true;
        // INFO whenever a connection is established, including recovery; readyState is Mongoose's state code.
        mongoose.connection.on('connected', () => log.info('connected', { readyState: mongoose.connection.readyState }));
        // WARN when connectivity drops; the driver will attempt automatic recovery.
        mongoose.connection.on('disconnected', () => log.warn('disconnected', { nextAction: 'driver_reconnect' }));
        // INFO when the driver confirms recovery, distinguishing reconnection from process startup.
        mongoose.connection.on('reconnected', () => log.info('reconnected', { nextAction: 'resume_operations' }));
        // ERROR for connection failures; classifications omit URI and credential-bearing messages.
        mongoose.connection.on('error', error => log.error('connection_failed', { ...safeError(error), nextAction: 'inspect_connectivity' }));
    }
    // INFO before the initial connection attempt; credentials are never logged.
    log.info('connecting');
    await mongoose.connect(process.env.MONGO_DB);
}

// Generic key-value state store — every module uses this instead of its own schema,
// unless it genuinely needs a structured model (put those in modules/<name>/model.js)
const moduleStateSchema = new mongoose.Schema({
    moduleName: { type: String, required: true },
    key: { type: String, required: true },
    value: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
moduleStateSchema.index({ moduleName: 1, key: 1 }, { unique: true });

const ModuleState = mongoose.model('ModuleState', moduleStateSchema);

async function getState(moduleName, key) {
    // DEBUG for state lookup attempts; only the owning module is included, not stored values.
    log.debug('state_read_started', { moduleName });
    const doc = await ModuleState.findOne({ moduleName, key });
    // DEBUG after a successful lookup; found distinguishes an absent baseline from existing state.
    log.debug('state_read_completed', { moduleName, found: Boolean(doc) });
    return doc?.value ?? null;
}

async function setState(moduleName, key, value) {
    // DEBUG before a state write; payloads and credentials are omitted.
    log.debug('state_write_started', { moduleName });
    await ModuleState.findOneAndUpdate(
        { moduleName, key },
        { value },
        { upsert: true }
    );
    // DEBUG only after MongoDB acknowledges the write.
    log.debug('state_write_completed', { moduleName });
}

module.exports = { connect, getState, setState, mongoose };
