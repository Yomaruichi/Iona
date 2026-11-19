const { processDue } = require('./runner');

const store = require('./store');

const { createLogger } = require('../core/logger');

const log = createLogger('highlights-scheduler');

function createHighlightJobs({ env, notify, process = processDue }) {
    if (env.HIGHLIGHTS_ENABLED !== 'true') {
        // INFO on disabled setup; no processing or delivery jobs are registered.
        log.info('disabled');

        return [];
    }

    let running = false;

    async function processHighlights() {
        if (running) {
            // INFO when a previous tick still owns this local runner; MongoDB also guards cross-process ownership.
            log.info('processing_skipped', { reason: 'already_running' });

            return;
        }

        running = true;

        try {
            // INFO before processing one due job on Iona's shared database connection.
            log.info('processing_started');

            await process(env);

            // INFO after the processing tick resolves; individual job/no-work results are logged by the runner.
            log.info('processing_completed');
        } finally {
            running = false;
        }
    }

    // INFO at enabled setup; schedules distinguish API/model processing from MongoDB-only delivery checks.
    log.info('enabled', { processingSchedule: '*/15 * * * *', deliverySchedule: '*/5 * * * *' });

    return [
        { schedule: '*/15 * * * *', label: 'highlight-processing', task: processHighlights },
        { schedule: '*/5 * * * *', label: 'highlight-links', task: () => store.deliverCompleted(notify) },
    ];
}

module.exports = { createHighlightJobs };
