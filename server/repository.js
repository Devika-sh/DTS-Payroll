import { getStore } from './storage/index.js';
import { nextId, timestamp, addAudit, storageError } from './storage/state.js';
import { workerSchema, entrySchema, calculate } from './domain.js';
const fail=(message,status=400)=>storageError(message,status);
const matchingName=(a,b)=>a.trim().toLowerCase()===b.trim().toLowerCase();
export class PayrollRepository {
  constructor(store) { this.store=store; }
  async data() {
    const {state}=await this.store.read();
    return {workers:[...state.workers].sort((a,b)=>a.name.localeCompare(b.name)),
      entries:[...state.entries].sort((a,b)=>a.entry_date.localeCompare(b.entry_date) || Number(b.kind==='opening')-Number(a.kind==='opening') || a.id-b.id),
      imports:[...state.imports].sort((a,b)=>b.id-a.id).map(({original_base64,...row})=>row),storage:this.store.kind};
  }
  async createWorker(input) {
    const w=workerSchema.parse(input);
    return this.store.mutate(state=>{
      if(state.workers.some(row=>matchingName(row.name,w.name)))throw fail('This worker already exists.',409);
      const row={id:nextId(state.workers),name:w.name,daily_rate:w.dailyRate,phone:w.phone,active:w.active,created_at:timestamp()};
      state.workers.push(row);addAudit(state,'worker',row.id,'create',null,row);return row.id;
    });
  }
  async updateWorker(workerId,input) {
    const w=workerSchema.parse(input);
    return this.store.mutate(state=>{
      const row=state.workers.find(w=>w.id===workerId);
      if(!row)throw fail('Worker not found.',404);
      if(state.workers.some(other=>other.id!==workerId&&matchingName(other.name,w.name)))throw fail('This worker already exists.',409);
      const before=structuredClone(row);
      Object.assign(row,{name:w.name,daily_rate:w.dailyRate,phone:w.phone,active:w.active});
      addAudit(state,'worker',row.id,'update',before,row);
    });
  }
  async saveEntry(input,entryId=null) {
    input=entrySchema.parse(input);
    return this.store.mutate(state=>{
      const worker=state.workers.find(w=>w.id===input.workerId);
      if(!worker)throw fail('Worker not found.',404);
      if(!worker.active&&!entryId)throw fail('Reactivate this worker before adding entries.');
      const c=calculate(input,worker.daily_rate);
      let row=entryId ? state.entries.find(e=>e.id===entryId) : null;
      const before=row ? structuredClone(row) : null;
      if(entryId) {
        if(!row||row.voided)throw fail('Entry not found.',404);
        if(row.version!==input.version)throw fail('This entry changed. Refresh before editing.',409);
        if(!input.reason)throw fail('A reason is required for historical corrections.');
        if(row.worker_id!==input.workerId)throw fail('An entry cannot be moved to another worker.');
      }
      if(['work','off'].includes(c.type)&&state.entries.some(e=>!e.voided&&e.worker_id===worker.id&&e.entry_date===c.date&&['work','off'].includes(e.kind)&&e.id!==entryId))throw fail('This worker already has a daily record for that date. Edit it instead.',409);
      if(!row){row={id:nextId(state.entries),worker_id:worker.id,created_at:timestamp(),version:0,voided:false,source_json:null,import_id:null};state.entries.push(row);}
      Object.assign(row,{entry_date:c.date,site:c.site,kind:c.type,salary_cents:c.salaryCents,ot_hours:c.otHours,ot_rate:c.otRate,ot_cents:c.otCents,total_cents:c.totalCents,
        advance_cents:c.advanceCents,notes:c.notes,review_note:'',version:row.version+1,updated_at:timestamp()});
      addAudit(state,'entry',row.id,entryId?'correct':'create',before,row,input.reason);return row.id;
    });
  }
  async voidEntry(entryId,input) {
    if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)throw fail('A reason of up to 500 characters is required.');
    return this.store.mutate(state=>{
      const row=state.entries.find(e=>e.id===entryId);
      if(!row||row.voided)throw fail('Entry not found.',404);
      if(row.version!==input.version)throw fail('Entry changed. Refresh first.',409);
      const before=structuredClone(row);Object.assign(row,{voided:true,version:row.version+1,updated_at:timestamp()});
      addAudit(state,'entry',entryId,'void',before,row,input.reason);
    });
  }
  async history(entryId) {const {state}=await this.store.read();return state.audit.filter(a=>a.entity==='entry'&&a.entity_id===entryId).sort((a,b)=>b.id-a.id);}
  async original(importId) {
    const {state}=await this.store.read(),row=state.imports.find(i=>i.id===importId);
    if(!row)throw fail('Import not found.',404);
    return {filename:row.filename,buffer:Buffer.from(row.original_base64,'base64')};
  }
}
export const repository=()=>new PayrollRepository(getStore());
