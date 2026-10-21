import fs from 'node:fs/promises';
import path from 'node:path';
import { getStore, closeStore } from '../server/storage/index.js';
try {
  const {state,revision}=await getStore().read();
  const dir=path.resolve('private/backups');await fs.mkdir(dir,{recursive:true});
  const filename=path.join(dir,`payroll-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  await fs.writeFile(filename,JSON.stringify({format:'dts-payroll-backup',revision,state}),{mode:0o600});
  console.log('Full payroll backup saved: '+filename);
} finally { await closeStore(); }
