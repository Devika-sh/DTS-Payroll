import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LayoutDashboard, Users, CalendarDays, BookOpen, Wallet, FolderDown, Plus, ArrowUpRight, ArrowRight, Download, Search, X, Check, AlertCircle, Upload, FileSpreadsheet, ChevronLeft, ChevronRight, Building2, Clock3, Menu, Pencil, History, Ban, RefreshCw } from 'lucide-react';
import { summarize, money } from '../server/domain.js';
import './styles.css';

const cash = cents => (Number(cents || 0) / 100).toLocaleString('en-IN', { style:'currency',currency:'INR',maximumFractionDigits:2 });
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift = (date, days) => { const d = new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };
const monday = date => shift(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7));
const shortDate = date => new Date(date+'T12:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
const nav = [['Overview',LayoutDashboard],['Workers',Users],['Daily entries',CalendarDays],['Worker ledger',BookOpen],['Weekly payroll',Wallet],['Reports & data',FolderDown]];
async function api(url, options={}) {
  const r = await fetch('/api'+url,{...options,headers:options.body instanceof FormData ? {} : {'Content-Type':'application/json',...options.headers}});
  if (!r.ok) { const data=await r.json().catch(()=>({error:'The server could not complete this request.'})); throw new Error(data.error); }
  return r.json();
}
function App() {
  const [page,setPage]=useState('Overview'),[data,setData]=useState({workers:[],entries:[],imports:[],storage:'excel'});
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[toast,setToast]=useState('');
  const [week,setWeek]=useState(monday(today())),[search,setSearch]=useState(''),[workerId,setWorkerId]=useState('');
  const [modal,setModal]=useState(null),[busy,setBusy]=useState(false),[mobile,setMobile]=useState(false);
  const [reviewOnly,setReviewOnly]=useState(false),[showVoided,setShowVoided]=useState(false);
  const [file,setFile]=useState(null),[preview,setPreview]=useState(null);
  const end=shift(week,6);
  async function reload() {
    try { const d=await api('/data'); setData(d); setError(''); return d; }
    catch(e){setError(e.message);} finally{setLoading(false);}
  }
  useEffect(()=>{reload();},[]);
  useEffect(()=>{
    if(!modal)return;
    const dialog=document.querySelector('[role="dialog"]');
    const focusable=()=>[...dialog.querySelectorAll('button,input,select,textarea,summary')].filter(el=>!el.disabled&&el.offsetParent!==null);
    const prior=document.activeElement;focusable()[0]?.focus();
    function handleKey(e){
      if(e.key==='Escape'&&!busy)setModal(null);
      if(e.key==='Tab'){
        const items=focusable(),first=items[0],last=items.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    }
    dialog.addEventListener('keydown',handleKey);
    return()=>{dialog.removeEventListener('keydown',handleKey);prior?.focus();};
  },[modal?.kind,busy]);
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(t);}},[toast]);
  const workers=data.workers;
  const entries=data.entries.filter(e=>!e.voided);
  const summary=useMemo(()=>summarize(data.workers,data.entries,week,end),[data,week,end]);
  const totals=summary.reduce((a,s)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+s[k]])),{regular:0,overtime:0,advances:0,earnings:0,payable:0,closing:0,otHours:0});
  const review=data.entries.filter(e=>!e.voided&&e.review_note);
  const missing=review.filter(e=>e.total_cents==null);
  const workerMap=Object.fromEntries(workers.map(w=>[w.id,w]));
  const filteredWorkers=workers.filter(w=>w.name.toLowerCase().includes(search.toLowerCase()));
  const visibleEntries=data.entries.filter(e=>(showVoided||!e.voided)&&(!workerId||e.worker_id===Number(workerId))&&(!reviewOnly||e.review_note)
    && (page==='Worker ledger'||(e.entry_date>=week&&e.entry_date<=end))
    && (!search||`${workerMap[e.worker_id]?.name} ${e.site}`.toLowerCase().includes(search.toLowerCase())));
  const ledgerBalances={}; const running={};
  data.entries.forEach(e=>{ if(!e.voided) running[e.worker_id]=(running[e.worker_id]||0)+Number(e.total_cents||0)-Number(e.advance_cents);ledgerBalances[e.id]=running[e.worker_id]||0; });
  function go(p) { setPage(p);setSearch('');setReviewOnly(false);setShowVoided(false);setMobile(false); }
  function openEntry(e=null, payment=false) {
    const w=workerMap[e?.worker_id || workerId] || workers.find(w=>w.active);
    if(!w){setToast('Add a worker first.');setModal({kind:'worker'});return;}
    setModal({kind:'entry',original:e,form:{workerId:e?.worker_id||w.id,date:e?.entry_date||today(),site:e?.site||'',type:e?.kind||(payment?'payment':'work'),
      salary:e ? (e.salary_cents==null?'':e.salary_cents/100) : Number(w.daily_rate),
      otHours:e?.ot_hours||0,otRate:e?.ot_rate??Number(w.daily_rate)/8,advance:(e?.advance_cents||0)/100,notes:e?.notes||'',reason:'',version:e?.version}});
  }
  async function save(path,body,method='POST') {
    setBusy(true);
    try{await api(path,{method,body:JSON.stringify(body)});await reload();setModal(null);setToast('Saved to payroll records.');}
    catch(e){setModal(m=>({...m,error:e.message}));}
    finally{setBusy(false);}
  }
  async function download(url,name) {
    setBusy(true);
    try {const r=await fetch('/api'+url);if(!r.ok)throw new Error((await r.json()).error);const u=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
    catch(e){setToast(e.message);}finally{setBusy(false);}
  }
  const pdf=(w)=>download(`/reports/pdf?from=${week}&to=${end}${w?'&workerId='+w:''}`,w?'worker-payslip.pdf':'weekly-payroll.pdf');
  async function inspectImport() {
    if(!file)return;
    setBusy(true);
    try{const f=new FormData();f.append('file',file);setPreview(await api('/import/preview',{method:'POST',body:f}));}
    catch(e){setToast(e.message);}finally{setBusy(false);}
  }
  async function commitImport() {
    setBusy(true);
    try{const f=new FormData();f.append('file',file);const r=await api('/import',{method:'POST',body:f});await reload();setPreview(null);setFile(null);setToast(`Imported ${r.rows} records for ${r.workers} workers.`);}
    catch(e){setToast(e.message);}finally{setBusy(false);}
  }
  const weekControl=<div className="week-control"><button aria-label="Previous week" onClick={()=>setWeek(shift(week,-7))}><ChevronLeft size={16}/></button><CalendarDays size={16}/><label><span className="sr-only">Week beginning</span><input type="date" value={week} onChange={e=>e.target.value&&setWeek(monday(e.target.value))}/></label><span className="week-end">– {shortDate(end)}</span><button aria-label="Next week" onClick={()=>setWeek(shift(week,7))}><ChevronRight size={16}/></button></div>;
  const workerSelect=<select aria-label="Filter by worker" value={workerId} onChange={e=>setWorkerId(e.target.value)}><option value="">All workers</option>{workers.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>;
  function Person({w,sub}) {return <div className="person"><span className={`avatar tone-${w.id%4}`}>{w.name.split(' ').slice(0,2).map(x=>x[0]).join('')}</span><div><strong>{w.name}</strong><small>{sub||`DTS-${String(w.id).padStart(3,'0')}`}</small></div></div>;}
  function PayrollTable({compact=false}) {return <div className="table-wrap"><table><thead><tr><th>Worker</th><th>Days</th><th>Regular wages</th><th>Overtime</th><th>Advances / paid</th>{!compact&&<th>Opening balance</th>}<th>{compact?'This week net':'Closing / payable'}</th><th></th></tr></thead><tbody>{summary.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())).map(s=><tr key={s.id}><td><Person w={s}/></td><td>{s.days}<span className="muted"> days</span></td><td>{cash(s.regular)}</td><td>{cash(s.overtime)}<small>{s.otHours} hrs</small></td><td>{cash(s.advances)}</td>{!compact&&<td>{cash(s.openingBalance)}</td>}<td className="strong green">{cash(compact?s.net:s.closing)}{!compact&&<small>Payable {cash(s.payable)}</small>}</td><td><button className="icon-btn" aria-label={`Download ${s.name} payslip`} disabled={busy} onClick={()=>pdf(s.id)}><Download size={17}/></button></td></tr>)}</tbody></table>{!workers.length&&<Empty title="Your payroll starts here" text="Import your workbook or add your first worker."/>}</div>;}
  function EntryTable() {return <div className="table-wrap"><table className="ledger-table"><thead><tr><th>Date / worker</th><th>Site / type</th><th>Salary</th><th>OT hrs</th><th>OT rate</th><th>OT amount</th><th>Total</th><th>ADV / STMT</th><th>Balance</th><th></th></tr></thead><tbody>{visibleEntries.map(e=><tr key={e.id} className={e.voided?'voided':''}><td><strong>{shortDate(e.entry_date)} {e.entry_date.slice(0,4)}</strong><small>{workerMap[e.worker_id]?.name}</small></td><td><span className="site-tag">{e.site||'—'}</span><small>{e.kind}{e.voided?' · voided':''}</small></td><td>{e.salary_cents==null?<span className="pending">Missing</span>:cash(e.salary_cents)}</td><td>{Number(e.ot_hours)}</td><td>{cash(money(e.ot_rate))}</td><td>{e.ot_cents==null?'—':cash(e.ot_cents)}</td><td className="strong">{e.total_cents==null?'Pending':cash(e.total_cents)}</td><td>{cash(e.advance_cents)}</td><td className="green">{cash(ledgerBalances[e.id])}</td><td><div className="row-actions">{e.review_note&&<button className="review-icon" aria-label="Review source note" title={e.review_note} onClick={()=>setModal({kind:'note',entry:e})}><AlertCircle size={17}/></button>}<button className="icon-btn" aria-label="Entry details and history" onClick={async()=>{try{const history=await api(`/entries/${e.id}/history`);setModal({kind:'history',entry:e,history});}catch(err){setToast(err.message);}}}><History size={16}/></button>{!e.voided&&<button className="icon-btn" aria-label={`Edit entry ${e.id}`} onClick={()=>openEntry(e)}><Pencil size={16}/></button>}</div></td></tr>)}</tbody></table>{!visibleEntries.length&&<Empty title="No entries in this view" text="Choose another week or worker, or record a new entry."/>}</div>;}
  return <div className="app-shell">
    {mobile&&<div className="sidebar-scrim" onClick={()=>setMobile(false)}/>}
    <aside className={mobile?'sidebar open':'sidebar'}>
      <a className="brand" href="#" onClick={e=>{e.preventDefault();go('Overview');}}><span className="brand-mark">d<span>.</span></span><div>dev technical<span>SERVICES</span></div></a>
      <div className="workspace"><span className="workspace-logo"><Building2 size={19}/></span><div><strong>Payroll workspace</strong><small>Dev Technical Services</small></div></div>
      <p className="nav-label">WORKSPACE</p>
      <nav>{nav.map(([name,Icon])=><button key={name} className={page===name?'nav-item selected':'nav-item'} onClick={()=>go(name)}><Icon size={19}/><span>{name}</span>{name==='Workers'&&<span className="nav-count">{workers.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="secure-note"><span className={error?'status-dot error-dot':'status-dot'}/><div><strong>{error?'Connection unavailable':loading?'Connecting…':data.storage==='google-sheets'?'Google Sheets connected':'Excel workbook connected'}</strong><small>Historical records preserved</small></div></div><div className="profile"><span className="avatar">DT</span><div><strong>Dev Technical Services</strong><small>Payroll administration</small></div></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-btn" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={21}/></button><span>Workspace</span><ChevronRight size={14}/><strong>{page}</strong></div><div className="topbar-right"><span className="local-badge"><span className="status-dot"/>Local workspace</span><span className="top-avatar">DT</span></div></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">DEV TECHNICAL SERVICES</p><h1>{page==='Overview'?'Payroll overview':page}</h1><p className="subtitle">{{Overview:'Your team, their time, and every rupee accounted for.',Workers:'Manage your team and individual daily wage rates.','Daily entries':'Record work, overtime, and payments in one place.','Worker ledger':'A complete, chronological history for every worker.','Weekly payroll':'Review earnings, advances, and balances for the week.','Reports & data':'Your payroll records, ready to import, download, and keep.'}[page]}</p></div><div className="heading-actions">{page==='Workers'?<button className="primary" onClick={()=>setModal({kind:'worker'})}><Plus size={17}/>Add worker</button>:page!=='Reports & data'&&<><button className="secondary" disabled={busy} onClick={()=>pdf(workerId||null)}><Download size={16}/><span>Download report</span></button><button className="primary" disabled={!workers.length} onClick={()=>openEntry()}><Plus size={18}/>New entry</button></>}</div></div>
        {error&&<div role="alert" className="error-banner"><AlertCircle size={20}/><div><strong>Unable to load payroll</strong><p>{error}</p></div><button onClick={reload} className="secondary"><RefreshCw size={15}/>Retry</button></div>}
        {loading?<Empty title="Loading payroll…" text="Connecting to your records."/>:<>
        {['Overview','Weekly payroll'].includes(page)&&<>
          <div className="section-toolbar"><div className="period-label"><span className="status-dot"/>{week===monday(today())?'This week':'Selected week'}<span className="muted">Monday – Sunday</span></div>{weekControl}</div>
          <div className="stats-grid">
            <Stat label="Active workers" value={workers.filter(w=>w.active).length.toString()} caption={`${workers.length} workers in your records`} icon={Users}/>
            <Stat label="Regular wages" value={cash(totals.regular)} caption={`${summary.reduce((n,s)=>n+s.days,0)} working dates this week`} icon={Wallet}/>
            <Stat label="Overtime earnings" value={cash(totals.overtime)} caption={`${totals.otHours} overtime hours recorded`} icon={Clock3}/>
            <Stat label="Advances & payments" value={cash(totals.advances)} caption="Paid during the selected week" icon={ArrowUpRight}/>
          </div>
        </>}
        {page==='Overview'&&<>
          <div className="overview-middle"><section className="card earnings-card"><div className="card-title"><div><h2>Weekly earnings</h2><p>Regular wages and overtime, day by day</p></div><div className="chart-legend"><span/>Regular<span/>Overtime</div></div><EarningsChart entries={entries} week={week}/></section><section className="balance-card"><div className="balance-icon"><Wallet size={22}/></div><p>Outstanding payable</p><h2>{cash(totals.payable)}</h2><span>As of {shortDate(end)} · includes prior balances</span><div className="balance-divider"/><div className="balance-detail"><span>This week’s earnings</span><strong>{cash(totals.earnings)}</strong></div><div className="balance-detail"><span>This week’s payments</span><strong>{cash(totals.advances)}</strong></div><button onClick={()=>go('Weekly payroll')}>Review weekly payroll<ArrowRight size={17}/></button></section></div>
          {review.length>0&&<div className="review-banner"><span className="review-badge"><AlertCircle size={19}/></span><div><strong>Historical workbook notes</strong><p>{review.length} entries retain source exceptions{missing.length?`, including ${missing.length} missing salaries`:''}. Review them before settling payments.</p></div><button onClick={()=>{go('Worker ledger');setReviewOnly(true);setWorkerId('');}}>Review entries<ArrowRight size={16}/></button></div>}
          <section className="card"><div className="card-title"><div><h2>Team payroll</h2><p>A quick look at this week’s wages</p></div><button className="text-button" onClick={()=>go('Weekly payroll')}>View payroll<ArrowRight size={15}/></button></div><PayrollTable compact/></section>
        </>}
        {page==='Workers'&&<><div className="section-toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search workers…"/><span className="muted">{filteredWorkers.length} workers</span></div><div className="worker-grid">{filteredWorkers.map(w=><section className="card worker-card" key={w.id}><div className="worker-card-head"><Person w={w}/><span className={w.active?'pill':'pill inactive'}>{w.active?'Active':'Inactive'}</span></div><div className="worker-rates"><div><small>Daily wage</small><strong>{cash(money(w.daily_rate))}</strong></div><div><small>Default OT / hour</small><strong>{cash(money(Number(w.daily_rate)/8))}</strong></div></div><div className="worker-meta"><span>Balance through latest entry</span><strong>{cash(running[w.id])}</strong></div>{w.phone&&<p className="muted">{w.phone}</p>}<div className="worker-card-actions"><button className="text-button" onClick={()=>{go('Worker ledger');setWorkerId(String(w.id));}}>View ledger<ArrowRight size={15}/></button><button className="secondary small" onClick={()=>setModal({kind:'worker',original:w})}><Pencil size={14}/>Edit</button></div></section>)}</div>{!filteredWorkers.length&&<Empty title="No workers found" text="Add a worker or try a different search."/>}</>}
        {['Daily entries','Worker ledger'].includes(page)&&<><div className="section-toolbar wrap"><div className="filter-group"><SearchBox value={search} onChange={setSearch} placeholder="Search worker or site…"/>{workerSelect}</div>{page==='Daily entries'?weekControl:<button className="secondary" onClick={()=>openEntry(null,true)}><Plus size={16}/>Record payment</button>}</div>{page==='Worker ledger'&&<div className="ledger-summary"><div><small>Ledger scope</small><strong>{workerId?workerMap[workerId]?.name:'All workers'} · all dates</strong></div><div><small>Balance through latest entry</small><strong>{cash(workerId?running[workerId]:Object.values(running).reduce((n,x)=>n+x,0))}</strong></div><p>Balance = earnings − advances / payments.<br/>Negative balances are advances still to recover.</p></div>}<div className="toggle-row"><label><input type="checkbox" checked={reviewOnly} onChange={e=>setReviewOnly(e.target.checked)}/>Needs review</label><label><input type="checkbox" checked={showVoided} onChange={e=>setShowVoided(e.target.checked)}/>Include voided records</label><span className="muted">{visibleEntries.length} records</span></div><section className="card"><EntryTable/></section></>}
        {page==='Weekly payroll'&&<><div className="payroll-summary"><div><small>Closing balance, all workers</small><strong>{cash(totals.closing)}</strong></div><div><small>Total payable</small><strong>{cash(totals.payable)}</strong></div><p>Opening balance + this week’s earnings − payments.<br/>Negative worker balances are carried forward, not paid out.</p></div><section className="card"><div className="card-title"><h2>Weekly breakdown</h2><SearchBox value={search} onChange={setSearch} placeholder="Find a worker…"/></div><PayrollTable/></section><p className="footnote">Working days count distinct dates with a positive salary. Half-day wages retain their actual amount. Reports include historical review notes.</p></>}
        {page==='Reports & data'&&<><div className="report-grid"><section className="card report-card"><span className="feature-icon"><Download size={23}/></span><h2>Payroll reports</h2><p>Download the combined weekly payroll or an individual worker’s payslip.</p>{weekControl}{workerSelect}<button className="primary" disabled={busy||!workers.length} onClick={()=>pdf(workerId||null)}><Download size={16}/>Download PDF</button></section><section className="card report-card"><span className="feature-icon"><FileSpreadsheet size={23}/></span><h2>Export & backup</h2><p>All active ledger records, one sheet per worker. Includes original column labels, running balances, and review notes.</p><div className="export-details"><span>{workers.length} worker sheets</span><span>{entries.length} ledger records</span></div><button className="secondary" disabled={busy||!workers.length} onClick={()=>download('/export','dev-technical-payroll.xlsx')}><Download size={16}/>Export workbook</button><button className="secondary" disabled={busy} onClick={()=>download('/backup','payroll-backup.json')}><Download size={16}/>Download full backup</button></section></div>
          <section className="card import-card"><div className="card-title"><div><h2>Import an existing workbook</h2><p>One worker per sheet, following your DATE / SITE / SAL / OT / ADV-STMT layout.</p></div><Upload size={23}/></div><div className="import-body"><label className="upload-zone"><FileSpreadsheet size={30}/><strong>{file?file.name:'Choose an Excel workbook'}</strong><span>.xlsx · up to 4 MB · preview before importing</span><input type="file" accept=".xlsx" onChange={e=>{setFile(e.target.files[0]||null);setPreview(null);}}/></label><button className="primary" disabled={!file||busy} onClick={inspectImport}>{busy?'Working…':'Preview import'}<ArrowRight size={16}/></button></div>{preview&&<div className="import-preview"><h3>{preview.rows} records across {preview.workers.length} workers</h3><p>{preview.skipped} blank or placeholder rows skipped. {preview.warnings.length} rows have review notes.</p><div className="preview-workers">{preview.workers.map(w=><span key={w.name}>{w.name} · {w.rows} rows</span>)}</div>{preview.duplicate?<div className="error-banner">This exact workbook is already imported.</div>:<button className="primary" disabled={busy} onClick={commitImport}><Check size={16}/>Import these records</button>}<details><summary>Review import notes</summary>{preview.warnings.map((w,i)=><p key={i}><strong>{w.worker}, row {w.row}:</strong> {w.message}</p>)}</details></div>}</section>
          <section className="card"><div className="card-title"><div><h2>Import history</h2><p>The original workbooks are preserved in your spreadsheet storage.</p></div></div><div className="table-wrap"><table><thead><tr><th>Workbook</th><th>Imported</th><th>Records</th><th>Original file</th></tr></thead><tbody>{data.imports.map(i=><tr key={i.id}><td><FileSpreadsheet size={17} className="inline-icon"/>{i.filename}</td><td>{String(i.created_at).replace('T',' ').slice(0,19)}</td><td>{i.summary.rows}</td><td><button className="text-button" disabled={busy} onClick={()=>download(`/imports/${i.id}/original`,i.filename)}><Download size={16}/>Download</button></td></tr>)}</tbody></table></div></section>
        </>}
        </>}
        <footer><span>Dev Technical Services</span><span>Payroll workspace · INR</span></footer>
      </main>
    </div>
    {toast&&<div role="status" className="toast">{toast}<button aria-label="Dismiss" onClick={()=>setToast('')}><X size={16}/></button></div>}
    {modal&&<div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&!busy&&setModal(null)}><section role="dialog" aria-modal="true" aria-label={modal.kind==='worker'?'Worker details':'Entry details'} className="modal"><div className="modal-heading"><h2>{modal.kind==='worker'?(modal.original?'Edit worker':'Add worker'):modal.kind==='entry'?(modal.original?'Correct ledger entry':'New daily entry'):modal.kind==='history'?'Entry history':'Source review note'}</h2><button className="icon-btn" disabled={busy} aria-label="Close dialog" onClick={()=>setModal(null)}><X size={20}/></button></div>
      {modal.error&&<div className="error-banner" role="alert">{modal.error}</div>}
      {modal.kind==='worker'&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save(modal.original?`/workers/${modal.original.id}`:'/workers',{name:f.get('name'),dailyRate:Number(f.get('dailyRate')),phone:f.get('phone'),active:f.get('active')==='on'},modal.original?'PUT':'POST');}}><div className="form-grid"><Field label="Worker name"><input name="name" required maxLength={100} defaultValue={modal.original?.name}/></Field><Field label="Daily wage (₹ / 8 hours)"><input name="dailyRate" required type="number" min=".01" step=".01" max="10000000" defaultValue={modal.original?.daily_rate||1300}/></Field><Field label="Phone (optional)"><input name="phone" maxLength={30} defaultValue={modal.original?.phone}/></Field><label className="check-field"><input name="active" type="checkbox" defaultChecked={modal.original?.active??true}/>Active worker</label></div><p className="form-hint">New overtime defaults to daily wage ÷ 8. Past entries keep their recorded rates.</p><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setModal(null)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save worker'}</button></div></form>}
      {modal.kind==='entry'&&<form onSubmit={e=>{e.preventDefault();save(modal.original?`/entries/${modal.original.id}`:'/entries',{...modal.form,workerId:Number(modal.form.workerId),salary:Number(modal.form.salary),otHours:Number(modal.form.otHours),otRate:Number(modal.form.otRate),advance:Number(modal.form.advance)},modal.original?'PUT':'POST');}}><EntryForm modal={modal} setModal={setModal} workers={workers}/><div className="modal-actions">{modal.original&&<button type="button" className="danger text-button" disabled={busy||!modal.form.reason.trim()} onClick={()=>save(`/entries/${modal.original.id}/void`,{reason:modal.form.reason,version:modal.original.version})}><Ban size={15}/>Void record</button>}<button type="button" className="secondary" onClick={()=>setModal(null)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':modal.original?'Save correction':'Save entry'}</button></div></form>}
      {modal.kind==='note'&&<><p className="note-text">{modal.entry.review_note}</p><p className="form-hint">The import retained the original amounts. A correction requires a reason and keeps the earlier record in the audit history.</p><button className="primary" onClick={()=>openEntry(modal.entry)}>Review and correct<ArrowRight size={16}/></button></>}
      {modal.kind==='history'&&<><p><strong>{workerMap[modal.entry.worker_id]?.name}</strong> · {modal.entry.entry_date}</p>{modal.entry.notes&&<p>{modal.entry.notes}</p>}{modal.entry.source_json&&<details><summary>Original workbook row</summary><pre>{JSON.stringify(modal.entry.source_json,null,2)}</pre></details>}{modal.history.length?modal.history.map(h=><div className="history-item" key={h.id}><strong>{h.action} · {String(h.created_at).slice(0,19)}</strong><p>{h.reason||'Entry recorded'}</p><details><summary>Saved changes</summary><pre>{JSON.stringify({before:h.before_json,after:h.after_json},null,2)}</pre></details></div>):<p className="form-hint">Imported original record. No corrections have been made.</p>}</>}
    </section></div>}
  </div>;
}
function Field({label,children}) {return <label className="field"><span>{label}</span>{children}</label>;}
function EntryForm({modal,setModal,workers}) {
  const f=modal.form, set=(key,value)=>setModal(m=>({...m,form:{...m.form,[key]:value}}));
  const work=f.type==='work';
  const salary=work?Number(f.salary||0):0,ot=work?money(Number(f.otHours||0)*Number(f.otRate||0)):0;
  return <><div className="form-grid"><Field label="Worker"><select value={f.workerId} disabled={!!modal.original} onChange={e=>{const w=workers.find(w=>w.id===Number(e.target.value));setModal(m=>({...m,form:{...m.form,workerId:w.id,salary:Number(w.daily_rate),otRate:Number(w.daily_rate)/8}}));}}>{workers.filter(w=>w.active||w.id===Number(f.workerId)).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></Field><Field label="Date"><input type="date" required value={f.date} onChange={e=>set('date',e.target.value)}/></Field><Field label="Entry type"><select value={f.type} onChange={e=>set('type',e.target.value)}><option value="work">Work day</option><option value="off">Off day</option><option value="payment">Payment / advance only</option><option value="opening">Opening advance</option></select></Field><Field label="Work site"><input required={work} maxLength={100} placeholder="e.g. SBLA" value={f.site} onChange={e=>set('site',e.target.value)}/></Field>{work&&<><Field label="Daily salary (₹)"><input type="number" required min="0" max="10000000" step=".01" value={f.salary} onChange={e=>set('salary',e.target.value)}/></Field><Field label="Overtime hours"><input type="number" required min="0" max="24" step=".01" value={f.otHours} onChange={e=>set('otHours',e.target.value)}/></Field><Field label="Overtime rate (₹ / hour)"><input type="number" required min="0" max="10000000" step=".0001" value={f.otRate} onChange={e=>set('otRate',e.target.value)}/></Field></>}<Field label="Advance / payment (₹)"><input type="number" required min={['payment','opening'].includes(f.type)?'.01':'0'} max="10000000" step=".01" value={f.advance} onChange={e=>set('advance',e.target.value)}/></Field></div><div className="calculation"><div><span>Overtime amount</span><strong>{cash(ot)}</strong></div><div><span>Total earnings</span><strong>{cash(money(salary)+ot)}</strong></div><div><span>Balance change</span><strong>{cash(money(salary)+ot-money(f.advance))}</strong></div></div><Field label="Notes (optional)"><textarea rows={2} maxLength={2000} value={f.notes} onChange={e=>set('notes',e.target.value)}/></Field>{modal.original&&<><p className="form-hint">{modal.original.review_note||'Corrections are saved with a complete audit history.'}</p><Field label="Reason for correction or voiding"><input required maxLength={500} value={f.reason} onChange={e=>set('reason',e.target.value)} placeholder="Explain why this record is changing"/></Field></>}</>;
}
function Stat({label,value,caption,icon:Icon}) {return <section className="card stat"><div className="stat-top"><span>{label}</span><Icon size={18}/></div><h2>{value}</h2><p>{caption}</p></section>;}
function SearchBox({value,onChange,placeholder}) {return <label className="search-box"><Search size={16}/><input aria-label={placeholder} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/></label>;}
function Empty({title,text}) {return <div className="empty"><BookOpen size={28}/><h3>{title}</h3><p>{text}</p></div>;}
function EarningsChart({entries,week}) {
  const days=Array.from({length:7},(_,i)=>{const date=shift(week,i);const rows=entries.filter(e=>e.entry_date===date);return {date,regular:rows.reduce((n,e)=>n+Number(e.salary_cents||0),0),ot:rows.reduce((n,e)=>n+Number(e.ot_cents||0),0)};});
  const max=Math.max(100000,...days.map(d=>d.regular+d.ot));
  return <div className="chart"><div className="chart-axis">{[1,.5,0].map(x=><span key={x}>{cash(max*x)}</span>)}</div><div className="chart-plot"><div className="gridlines"><i/><i/><i/></div><div className="chart-bars">{days.map(d=><div className="chart-column" key={d.date}><div className="bar-slot" title={`${d.date}: ${cash(d.regular+d.ot)}`}><div className="bar-stack" style={{height:`${(d.regular+d.ot)/max*100}%`}}>{d.ot>0&&<div className="bar-ot" style={{flex:d.ot}}/>}{d.regular>0&&<div className="bar-regular" style={{flex:d.regular}}/>}</div></div><span>{new Date(d.date+'T12:00:00Z').toLocaleDateString('en-IN',{weekday:'short'})}</span><small>{shortDate(d.date)}</small></div>)}</div></div></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
