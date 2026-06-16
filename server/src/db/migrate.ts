import { closeDb, initDb } from './index';

async function migrate() {
  await initDb();
  console.log('Database migration complete');
  await closeDb();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
