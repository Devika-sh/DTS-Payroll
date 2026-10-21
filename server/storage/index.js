import 'dotenv/config';
import { LocalSpreadsheetStore } from './local.js';
import { GoogleSpreadsheetStore } from './google.js';
import { storageError } from './state.js';
import { withMigrations } from './migrations.js';
import { MongoStore } from './mongodb.js';

export function createStore(env=process.env) {
  const mode=env.STORAGE_MODE || 'mongodb';
  if(mode==='mongodb')return new MongoStore(env.MONGODB_URI,env.MONGODB_DB || 'dts_payroll');
  if(mode==='google-sheets')return withMigrations(new GoogleSpreadsheetStore(env.SHEETS_WEB_APP_URL,env.SHEETS_SECRET));
  if(mode!=='excel')throw storageError('STORAGE_MODE must be mongodb, excel or google-sheets.');
  if(env.VERCEL)throw storageError('Local Excel storage is not durable on Vercel. Configure MongoDB before deployment.');
  return withMigrations(new LocalSpreadsheetStore(env.PAYROLL_FILE || 'private/payroll.xlsx'));
}
let store;
export const getStore=()=>store ||= createStore();
export const closeStore=async()=>{if(store?.close)await store.close();store=undefined;};
