import { getStore } from '../server/storage/index.js';
const store = getStore();
const { state } = await store.read();
console.log(JSON.stringify({
  storage: store.kind,
  migrations: state.migrations,
  workers: state.workers.length,
  totalEntries: state.entries.length,
  archivedEntries: state.entries.filter(entry => entry.voided).length,
}, null, 2));
