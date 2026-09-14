const mongoose = require('mongoose');

async function connect() {
    mongoose.connection.on('connected', () => console.log('Connected to the database'));
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
    const doc = await ModuleState.findOne({ moduleName, key });
    return doc?.value ?? null;
}

async function setState(moduleName, key, value) {
    await ModuleState.findOneAndUpdate(
        { moduleName, key },
        { value },
        { upsert: true }
    );
}

module.exports = { connect, getState, setState, mongoose };