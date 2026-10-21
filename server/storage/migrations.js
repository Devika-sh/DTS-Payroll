import { storageError } from './state.js';

export const CLEAR_OLD_ENTRIES = '2026-10-21-clear-all-payroll-entries';

function applied(state) {
  if (state.migrations !== undefined && (!Array.isArray(state.migrations) || state.migrations.some(id => typeof id !== 'string'))) {
    throw storageError('Invalid spreadsheet migration history. Restore a valid backup before proceeding.');
  }
  return (state.migrations || []).includes(CLEAR_OLD_ENTRIES);
}

// User-requested reset, versioned in Git. The persisted marker prevents a restart
// or another Vercel instance from deleting entries created after this reset.
export function withMigrations(store) {
  let pending;
  async function ensureMigrated() {
    if (!pending) {
      pending = (async () => {
        const snapshot = await store.read();
        if (applied(snapshot.state)) return;
        await store.mutate(state => {
          // Check again inside the store's lock / compare-and-swap transaction.
          if (applied(state)) return;
          state.entries = [];
          state.imports = [];
          state.audit = state.audit.filter(record => record.entity === 'worker');
          state.migrations = [...(state.migrations || []), CLEAR_OLD_ENTRIES];
        });
      })();
      pending.catch(() => { pending = undefined; });
    }
    return pending;
  }
  return {
    kind: store.kind,
    async read() { await ensureMigrated(); return store.read(); },
    async mutate(fn) { await ensureMigrated(); return store.mutate(fn); },
  };
}
