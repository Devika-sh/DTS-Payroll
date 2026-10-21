import 'dotenv/config';
import { LocalSpreadsheetStore } from '../server/storage/local.js';
import { GoogleSpreadsheetStore } from '../server/storage/google.js';
const local=new LocalSpreadsheetStore(process.env.PAYROLL_FILE || 'private/payroll.xlsx');
const cloud=new GoogleSpreadsheetStore(process.env.SHEETS_WEB_APP_URL,process.env.SHEETS_SECRET);
const {state,revision}=await local.read();
if(!revision)throw new Error('No local payroll workbook exists. Nothing was uploaded.');
await cloud.mutate(target=>{
  if(target.workers.length||target.entries.length||target.imports.length||target.audit.length)throw new Error('The Google spreadsheet is not empty. Upload refused to protect existing data.');
  Object.assign(target,structuredClone(state));
});
console.log(`Uploaded ${state.workers.length} workers, ${state.entries.length} retained entries, and all history to Google Sheets.`);
