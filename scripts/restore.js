import fs from 'node:fs/promises';
import { getStore } from '../server/storage/index.js';
import { validateState } from '../server/storage/state.js';
const filename=process.argv[2];
if(!filename)throw new Error('Usage: npm run restore -- path/to/payroll-backup.json');
const backup=JSON.parse(await fs.readFile(filename,'utf8'));
if(backup.format!=='dts-payroll-backup')throw new Error('Not a payroll backup.');
const restored=validateState(backup.state);
await getStore().mutate(state=>{
  if(state.workers.length||state.entries.length||state.imports.length||state.audit.length)throw new Error('Restore requires an empty destination. Configure a new workbook or an empty Google spreadsheet.');
  Object.assign(state,structuredClone(restored));
});
console.log('Backup restored into the empty destination.');
