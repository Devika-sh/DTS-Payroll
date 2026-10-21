import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { emptyState, encodeState, decodeState, digest, chunks, reviewTables, storageError } from './state.js';

export class LocalSpreadsheetStore {
  constructor(filename) { this.filename = path.resolve(filename); this.kind = 'excel'; }
  async read() {
    const book = new ExcelJS.Workbook();
    try { await book.xlsx.load(await fs.readFile(this.filename)); }
    catch (error) {
      if (error.code === 'ENOENT') return { revision: 0, state: emptyState() };
      throw storageError('Cannot read the payroll workbook. Close Excel if it has locked the file, or restore a backup.');
    }
    const meta = book.getWorksheet('_State');
    if (!meta) throw storageError('This is not an application storage workbook. Use the Import screen for worker ledgers.');
    const revision = Number(meta.getCell('B1').value);
    const expected = meta.getCell('B2').value;
    const count = Number(meta.getCell('B3').value);
    const data = Array.from({length: count}, (_, i) => meta.getCell(i+5,1).value || '').join('');
    if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isInteger(count) || count < 1 || digest(data) !== expected) throw storageError('Payroll workbook integrity check failed. Restore a backup.');
    return { revision, state: decodeState(data) };
  }
  async write(state, revision) {
    const book = new ExcelJS.Workbook();
    book.creator = 'Dev Technical Services';
    for (const [name, rows] of Object.entries(reviewTables(state))) {
      const sheet = book.addWorksheet(name);
      sheet.addRows(rows);
      sheet.views = [{state:'frozen',ySplit:1}];
      sheet.columns.forEach((c,i) => { c.width = i === 1 ? 25 : name === 'Ledger' && i >= 13 ? 55 : 20; });
      sheet.getRow(1).font = {bold:true,color:{argb:'FFFFFFFF'}};
      sheet.getRow(1).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF155B49'}};
      sheet.getRow(1).height = 25;
      sheet.autoFilter = {from:{row:1,column:1},to:{row:1,column:rows[0].length}};
      if(name === 'Ledger') for (const i of [6,8,9,10,11,12]) sheet.getColumn(i).numFmt = '#,##0.00';
    }
    const data = encodeState(state), parts = chunks(data);
    const meta = book.addWorksheet('_State', {state:'veryHidden'});
    meta.addRows([['Revision',revision],['SHA-256',digest(data)],['Chunks',parts.length],['Compressed application state — do not edit'],...parts.map(p=>[p])]);
    const temp = `${this.filename}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, Buffer.from(await book.xlsx.writeBuffer()), {mode:0o600});
      const handle = await fs.open(temp,'r+');try { await handle.sync(); } finally { await handle.close(); }
      try { await fs.copyFile(this.filename, `${this.filename}.previous.xlsx`); } catch(e) { if(e.code!=='ENOENT')throw e; }
      await fs.rename(temp,this.filename);
    } finally { await fs.unlink(temp).catch(()=>{}); }
  }
  async mutate(fn) {
    await fs.mkdir(path.dirname(this.filename), {recursive:true});
    const lockPath = this.filename+'.lock';
    let lock;
    for(let attempt=0;attempt<100;attempt++) {
      try { lock=await fs.open(lockPath,'wx');break; }
      catch(e) { if(e.code!=='EEXIST')throw e;await new Promise(resolve=>setTimeout(resolve,50)); }
    }
    if(!lock)throw storageError('The payroll workbook is busy. Retry shortly. If a server crashed, follow the lock recovery instructions.');
    try {
      await lock.writeFile(JSON.stringify({pid:process.pid,started:new Date().toISOString()}));
      const {state,revision}=await this.read();
      const result=await fn(state);
      await this.write(state,revision+1);
      return result;
    } finally { await lock.close();await fs.unlink(lockPath); }
  }
}
