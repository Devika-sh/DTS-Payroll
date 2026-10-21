import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalSpreadsheetStore } from '../server/storage/local.js';
import { withMigrations, CLEAR_OLD_ENTRIES } from '../server/storage/migrations.js';
import { PayrollRepository } from '../server/repository.js';

test('versioned reset removes all old entries once and preserves later entries across instances', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'payroll-migration-'));
  try {
    const filename = path.join(dir, 'payroll.xlsx');
    const raw = new LocalSpreadsheetStore(filename);
    await raw.mutate(state => {
      state.workers.push({ id: 1, name: 'Worker', daily_rate: 1300, phone: '', active: true });
      state.entries.push({ id: 1, worker_id: 1, entry_date: '2026-10-19', kind: 'work', salary_cents: 130000, total_cents: 130000, advance_cents: 0, voided: true });
      state.entries.push({ id: 2, worker_id: 1, entry_date: '2026-10-20', kind: 'payment', salary_cents: 0, total_cents: 0, advance_cents: 50000, voided: false });
      state.imports.push({ id: 1, filename: 'old.xlsx', summary: { workers: 1, rows: 2 } });
      state.audit.push({ id: 1, entity: 'entry', entity_id: 1, action: 'void' });
      state.audit.push({ id: 2, entity: 'worker', entity_id: 1, action: 'create' });
    });
    const first = withMigrations(new LocalSpreadsheetStore(filename));
    const second = withMigrations(new LocalSpreadsheetStore(filename));
    await Promise.all([first.read(), second.read()]);
    const { state } = await first.read();
    assert.equal(state.entries.length, 0);
    assert.equal(state.imports.length, 0);
    assert.equal(state.workers.length, 1);
    assert.deepEqual(state.audit.map(row => row.entity), ['worker']);
    assert.deepEqual(state.migrations, [CLEAR_OLD_ENTRIES]);
    const repo = new PayrollRepository(first);
    await repo.saveEntry({ workerId: 1, date: '2026-10-21', site: 'SBLA', salary: 1300 });
    const restarted = withMigrations(new LocalSpreadsheetStore(filename));
    assert.equal((await restarted.read()).state.entries.length, 1);
    assert.equal((await second.read()).state.entries.length, 1);
    assert.equal((await first.read()).state.entries.length, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
