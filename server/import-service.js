import { parseWorkbook } from './workbook.js';
import { getStore } from './storage/index.js';
import { nextId, timestamp, storageError, addAudit } from './storage/state.js';
export async function importWorkbook(buffer,filename,store=getStore()) {
  const parsed=await parseWorkbook(buffer);
  return store.mutate(state=>{
    if(state.imports.some(i=>i.file_hash===parsed.hash))throw storageError('This exact workbook has already been imported.',409);
    const summary={workers:parsed.workers.length,rows:parsed.rowCount,warnings:parsed.warnings,skipped:parsed.skipped};
    const batch={id:nextId(state.imports),file_hash:parsed.hash,filename,original_base64:buffer.toString('base64'),summary,created_at:timestamp()};state.imports.push(batch);
    for(const worker of parsed.workers) {
      let w=state.workers.find(w=>w.name.trim().toLowerCase()===worker.name.trim().toLowerCase());
      if(!w){w={id:nextId(state.workers),name:worker.name,daily_rate:worker.dailyRate,phone:'',active:true,created_at:timestamp()};state.workers.push(w);}
      for(const e of worker.rows) {
        if(state.entries.some(row=>!row.voided&&row.worker_id===w.id&&row.entry_date===e.date&&(row.kind===e.kind||(['work','off'].includes(row.kind)&&['work','off'].includes(e.kind)))))throw storageError(`${worker.name}, ${e.date}: an entry already exists. No data was imported. Review overlapping workbooks first.`,409);
        state.entries.push({id:nextId(state.entries),worker_id:w.id,entry_date:e.date,site:e.site,kind:e.kind,salary_cents:e.salaryCents,
          ot_hours:e.otHours,ot_rate:e.otRate,ot_cents:e.otCents,total_cents:e.totalCents,advance_cents:e.advanceCents,notes:e.notes,
          review_note:e.reviewNote,source_json:e.source,import_id:batch.id,version:1,voided:false,created_at:timestamp(),updated_at:timestamp()});
      }
    }
    addAudit(state,'import',batch.id,'import',null,{id:batch.id,filename,...summary});return {id:batch.id,...summary};
  });
}
