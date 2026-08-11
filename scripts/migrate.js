const { migrate, pool } = require('../server/db');

migrate()
  .then(() => {
    console.log('Migrations complete');
    return pool.end();
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
    return pool.end();
  });
