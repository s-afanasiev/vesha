const { migrate, pool } = require('../server/db');
const {
  backfillImageHashes,
  cleanupDuplicateLooks,
} = require('../server/services/imageHash');

migrate()
  .then(async () => {
    console.log('Migrations complete');
    const hashed = await backfillImageHashes();
    if (hashed) console.log('Backfilled image hashes:', hashed);
    const removed = await cleanupDuplicateLooks();
    if (removed) console.log('Removed duplicate looks:', removed);
  })
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
    return pool.end();
  });
