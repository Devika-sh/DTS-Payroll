import { MongoClient, BSON } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { emptyState, validateState, storageError } from './state.js';

// One atomic document preserves the repository's all-or-nothing mutations,
// including imports and audit records, on standalone MongoDB and Atlas alike.
export class MongoStore {
  constructor(uri, database = 'dts_payroll', client) {
    if (!uri) throw storageError('Configure MONGODB_URI to connect MongoDB.');
    this.kind = 'mongodb';
    this.client = client || new MongoClient(uri, {
      maxPoolSize: 10, maxIdleTimeMS: 60000, serverSelectionTimeoutMS: 10000,
      writeConcern: { w: 'majority' }, readPreference: 'primary',
    });
    this.collection = this.client.db(database).collection('payroll_state');
  }

  async read() {
    let document;
    try { document = await this.collection.findOne({ _id: 'payroll' }); }
    catch { throw storageError('MongoDB could not be reached. Check the connection string, database user and network access.'); }
    if (!document) return { revision: 0, state: emptyState(), commits: [] };
    return { revision: document.revision, state: validateState(document.state), commits: document.commits || [] };
  }

  async mutate(fn) {
    const transactionId = randomUUID();
    for (let attempt = 0; attempt < 10; attempt++) {
      const { state, revision, commits } = await this.read();
      const result = await fn(state);
      const document = { _id: 'payroll', revision: revision + 1,
        state: validateState(state), commits: [...commits, transactionId].slice(-1000) };
      if (BSON.calculateObjectSize(document) > 15 * 1024 * 1024) {
        throw storageError('Payroll storage exceeds the 15 MiB safety limit. Export a backup and expand the storage design before adding more records.', 413);
      }
      try {
        if (revision === 0) await this.collection.insertOne(document);
        else {
          const saved = await this.collection.replaceOne({ _id: 'payroll', revision }, document);
          if (!saved.matchedCount) continue;
        }
        return result;
      } catch (error) {
        if (error.code === 11000 && revision === 0) continue;
        // Never replay an uncertain write: it could duplicate a payment.
        try { if ((await this.read()).commits.includes(transactionId)) return result; } catch {}
        throw storageError('MongoDB save could not be confirmed. Refresh the ledger before retrying.');
      }
    }
    throw storageError('Payroll changed repeatedly while saving. Refresh and try again.', 409);
  }

  async close() { await this.client.close(); }
}
