import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const emptyState = () => ({ schema: 1, workers: [], entries: [], imports: [], audit: [] });
export const storageError = (message, status = 503) => Object.assign(new Error(message), { status });
export function validateState(state) {
  if (state?.schema !== 1 || !['workers','entries','imports','audit'].every(k => Array.isArray(state[k]))) {
    throw storageError('The payroll spreadsheet has an unsupported or damaged storage format. Restore a backup.');
  }
  for (const key of ['workers','entries','imports','audit']) {
    const ids = state[key].map(row => row.id);
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw storageError(`Invalid IDs in ${key}.`);
  }
  return state;
}
export const encodeState = state => gzipSync(Buffer.from(JSON.stringify(validateState(state)))).toString('base64');
export const decodeState = data => validateState(JSON.parse(gunzipSync(Buffer.from(data, 'base64')).toString('utf8')));
export const digest = data => createHash('sha256').update(data).digest('hex');
export const chunks = data => data.match(/.{1,30000}/g) || [''];
export const nextId = rows => rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
export const timestamp = () => new Date().toISOString();
export function addAudit(state, entity, entityId, action, before, after, reason = '') {
  state.audit.push({ id: nextId(state.audit), entity, entity_id: entityId, action, reason,
    before_json: before ? structuredClone(before) : null, after_json: after ? structuredClone(after) : null, created_at: timestamp() });
}
// The visible sheets are review views. The full, checksummed state retains nullable
// amounts, source cells, originals, and audit snapshots without Excel cell-size loss.
export function reviewTables(state) {
  const names = Object.fromEntries(state.workers.map(w => [w.id, w.name]));
  const balances = {};
  const ledger = [...state.entries].sort((a,b) => a.entry_date.localeCompare(b.entry_date) || (b.kind === 'opening') - (a.kind === 'opening') || a.id-b.id);
  return {
    Workers: [['ID','Worker','Daily wage (INR)','Default OT / hour (INR)','Phone','Active'],
      ...state.workers.map(w => [w.id,w.name,w.daily_rate,w.daily_rate/8,w.phone,w.active?'Yes':'No'])],
    Ledger: [['ID','Worker','DATE','SITE','TYPE','SAL','OT.HRS','OT. RATE','OT AMT','TOTAL','ADV/STMT','Balance','Status','Review note','Notes'],
      ...ledger.map(e => {
        if (!e.voided) balances[e.worker_id] = (balances[e.worker_id] || 0) + (e.total_cents || 0) - e.advance_cents;
        const r = cents => cents == null ? null : cents / 100;
        return [e.id,names[e.worker_id] || '',e.entry_date,e.site,e.kind,r(e.salary_cents),e.ot_hours,e.ot_rate,r(e.ot_cents),r(e.total_cents),r(e.advance_cents),(balances[e.worker_id] || 0)/100,e.voided?'Voided':'Active',e.review_note,e.notes];
      })],
    Audit: [['ID','Entity','Record ID','Action','Reason','Recorded at'],
      ...state.audit.map(a => [a.id,a.entity,a.entity_id,a.action,a.reason,a.created_at])],
    Imports: [['ID','Filename','Imported at','Workers','Records','SHA-256'],
      ...state.imports.map(i => [i.id,i.filename,i.created_at,i.summary.workers,i.summary.rows,i.file_hash])],
  };
}
