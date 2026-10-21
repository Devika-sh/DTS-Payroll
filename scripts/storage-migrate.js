import { getStore, closeStore } from '../server/storage/index.js';
try {
  const store = getStore();
  const { state } = await store.read();
  console.log(JSON.stringify({
    storage: store.kind,
    migrations: state.migrations,
    workers: state.workers.length,
    totalEntries: state.entries.length,
    archivedEntries: state.entries.filter(entry => entry.voided).length,
  }, null, 2));
} finally { await closeStore(); }
