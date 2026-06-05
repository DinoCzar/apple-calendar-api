import { pool, initDb } from './index';
import { config } from '../config';

async function migrate() {
  await initDb();
  await pool.query(
    `UPDATE settings SET value = $1 WHERE key = 'working_hours_start'`,
    [config.defaults.workingHoursStart]
  );
  await pool.query(
    `UPDATE settings SET value = $1 WHERE key = 'working_hours_end'`,
    [config.defaults.workingHoursEnd]
  );
  console.log('Database migration complete');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
