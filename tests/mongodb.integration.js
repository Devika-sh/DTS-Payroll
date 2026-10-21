import test from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoStore } from '../server/storage/mongodb.js';
import { PayrollRepository } from '../server/repository.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalSpreadsheetStore } from '../server/storage/local.js';

test('MongoDB persistence, concurrent writes, rollback, ambiguous writes and HTTP payroll', async () => {
  const server = await MongoMemoryServer.create();
  const uri = server.getUri();
  const store = new MongoStore(uri, 'storage_test');
  const second = new MongoStore(uri, 'storage_test');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'payroll-mongo-'));
  const childEnv = { ...process.env, TEST_MONGODB_URI: uri, MONGODB_URI: uri, MONGODB_DB: 'transfer_test', STORAGE_MODE: 'mongodb' };
  delete childEnv.NODE_TEST_CONTEXT;
  const run = (args) => promisify(execFile)(process.execPath, args, { env: childEnv, timeout: 120000 });
  try {
    const repo = new PayrollRepository(store);
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      new PayrollRepository(i % 2 ? store : second).createWorker({ name: `Worker ${i}`, dailyRate: 1300 })));
    assert.equal((await second.read()).state.workers.length, 8);
    const before = await store.read();
    await assert.rejects(store.mutate(state => { state.workers.length = 0; throw new Error('rollback'); }), /rollback/);
    assert.deepEqual(await second.read(), before);
    const replace = store.collection.replaceOne.bind(store.collection);
    store.collection.replaceOne = async (...args) => { await replace(...args); throw new Error('lost response'); };
    await repo.createWorker({ name: 'Saved exactly once', dailyRate: 1300 });
    assert.equal((await second.read()).state.workers.length, 9);
    store.collection.replaceOne = replace;
    await assert.rejects(store.mutate(state => { state.large = 'x'.repeat(16 * 1024 * 1024); }), /safety limit/);
    assert.equal((await second.read()).state.large, undefined);
    await store.mutate(state => { state.entries.push({ id: 1, voided: true }); });
    assert.equal((await second.read()).state.entries.length, 1, 'reads must not run the legacy reset');
    childEnv.PAYROLL_FILE = path.join(directory, 'source.xlsx');
    const source = new LocalSpreadsheetStore(childEnv.PAYROLL_FILE);
    await source.mutate(state => Object.assign(state, before.state));
    // No migration marker: transfer must preserve even pre-reset history.
    await source.mutate(state => state.entries.push({ id: 1, worker_id: 1, entry_date: '2026-10-20', voided: true, advance_cents: 0 }));
    const original = await source.read();
    await run(['scripts/mongodb-upload.js', 'excel']);
    const destination = new MongoStore(uri, 'transfer_test');
    try { assert.deepEqual((await destination.read()).state, original.state); }
    finally { await destination.close(); }
    await assert.rejects(run(['scripts/mongodb-upload.js', 'excel']), /not empty/);
    assert.deepEqual(await source.read(), original);
    const backup = path.join(directory, 'backup.json');
    await fs.writeFile(backup, JSON.stringify({ format: 'dts-payroll-backup', state: original.state }));
    childEnv.MONGODB_DB = 'restore_test';
    await run(['scripts/restore.js', backup]);
    await assert.rejects(run(['scripts/restore.js', backup]), /empty destination/);
    const restored = new MongoStore(uri, 'restore_test');
    try { assert.deepEqual((await restored.read()).state, original.state); }
    finally { await restored.close(); }
    const { stdout } = await run(['--test', '--test-reporter=tap', 'tests/integration.js']);
    assert.match(stdout, /# fail 0/);
  } finally {
    await Promise.all([store.close(), second.close()]);
    await server.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
