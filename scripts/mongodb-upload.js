import 'dotenv/config';
import { LocalSpreadsheetStore } from '../server/storage/local.js';
import { GoogleSpreadsheetStore } from '../server/storage/google.js';
import { MongoStore } from '../server/storage/mongodb.js';

const sourceMode = process.argv[2] || 'excel';
if (!['excel', 'google-sheets'].includes(sourceMode)) throw new Error('Usage: npm run mongodb:upload -- [excel|google-sheets]');
// Read the source directly: historical destructive migrations must not run here.
const source = sourceMode === 'excel'
  ? new LocalSpreadsheetStore(process.env.PAYROLL_FILE || 'private/payroll.xlsx')
  : new GoogleSpreadsheetStore(process.env.SHEETS_WEB_APP_URL, process.env.SHEETS_SECRET);
const target = new MongoStore(process.env.MONGODB_URI, process.env.MONGODB_DB || 'dts_payroll');
try {
  const { state, revision } = await source.read();
  if (!revision) throw new Error('No source payroll data exists. Nothing was uploaded.');
  await target.mutate(destination => {
    if (['workers', 'entries', 'imports', 'audit'].some(key => destination[key].length)) {
      throw new Error('MongoDB destination is not empty. Upload refused to protect existing data.');
    }
    Object.assign(destination, structuredClone(state));
  });
  console.log(`Copied ${state.workers.length} workers, ${state.entries.length} entries and all history to MongoDB. Source unchanged.`);
} finally { await target.close(); }
