const cron = require('node-cron');

function registerJob(schedule, task, label = 'unnamed') {
    cron.schedule(schedule, async () => {
        try {
            await task();
        } catch (err) {
            console.error(`Cron job "${label}" failed:`, err);
        }
    });
    console.log(`Scheduled job: ${label} (${schedule})`);
}

module.exports = { registerJob };