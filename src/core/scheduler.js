const cron = require('node-cron');
const { createLogger, safeError } = require('./logger');
const log = createLogger('scheduler');

function registerJob(schedule, task, label = 'unnamed') {
    cron.schedule(schedule, async () => {
        const started = Date.now();
        // INFO when the scheduled callback begins; label identifies the job, started identifies this run.
        log.info('job_started', { label, started });
        try {
            await task();
            // INFO only after the task resolves; elapsedMs measures this execution.
            log.info('job_completed', { label, elapsedMs: Date.now() - started });
        } catch (err) {
            // ERROR when a run fails without stopping the scheduler; the next cron occurrence retries.
            log.error('job_failed', { label, ...safeError(err), elapsedMs: Date.now() - started, nextAction: 'next_scheduled_run' });
        }
    });
    // INFO after registration; schedule is the cron expression used for future runs.
    log.info('job_registered', { label, schedule });
}

module.exports = { registerJob };
