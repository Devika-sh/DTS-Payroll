import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import { repository } from './repository.js';
import { getStore } from './storage/index.js';
import { dateSchema, summarize } from './domain.js';
import { parseWorkbook } from './workbook.js';
import { importWorkbook } from './import-service.js';
import { pdfReport, excelReport } from './reports.js';
export const app=express();
app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'"],'style-src':["'self'","'unsafe-inline'"]}}}));
app.use(express.json({limit:'1mb'}));
app.use('/api',(req,res,next)=>{
  const origin=req.get('origin');
  const allowed=new Set((process.env.APP_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean));
  if(!process.env.VERCEL)for(const host of ['localhost','127.0.0.1'])for(const port of ['3001','5173'])allowed.add(`http://${host}:${port}`);
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&origin&&!allowed.has(origin))return res.status(403).json({error:'Untrusted origin. Set APP_ORIGINS to your deployed app URL.'});
  next();
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:4*1024*1024,files:1}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw fail('Invalid ID.');return n;};
function dates(q){const from=dateSchema.parse(q.from),to=dateSchema.parse(q.to);if(from>to)throw fail('Start date must be before end date.');return {from,to};}
app.get('/api/health',async(req,res)=>{await getStore().read();res.json({storage:getStore().kind,status:'connected'});});
app.get('/api/data',async(req,res)=>res.json(await repository().data()));
app.post('/api/workers',async(req,res)=>res.status(201).json({id:await repository().createWorker(req.body)}));
app.put('/api/workers/:id',async(req,res)=>{await repository().updateWorker(id(req.params.id),req.body);res.json({ok:true});});
app.post('/api/entries',async(req,res)=>res.status(201).json({id:await repository().saveEntry(req.body)}));
app.put('/api/entries/:id',async(req,res)=>res.json({id:await repository().saveEntry(req.body,id(req.params.id))}));
app.post('/api/entries/:id/void',async(req,res)=>{await repository().voidEntry(id(req.params.id),req.body);res.json({ok:true});});
app.get('/api/entries/:id/history',async(req,res)=>res.json(await repository().history(id(req.params.id))));
app.post('/api/import/preview',upload.single('file'),async(req,res)=>{
  if(!req.file)throw fail('Choose an Excel workbook.');
  const p=await parseWorkbook(req.file.buffer),{state}=await getStore().read();
  res.json({workers:p.workers.map(w=>({name:w.name,rate:w.dailyRate,rows:w.rows.length})),rows:p.rowCount,warnings:p.warnings,skipped:p.skipped,duplicate:state.imports.some(i=>i.file_hash===p.hash)});
});
app.post('/api/import',upload.single('file'),async(req,res)=>{if(!req.file)throw fail('Choose an Excel workbook.');res.status(201).json(await importWorkbook(req.file.buffer,req.file.originalname));});
app.get('/api/imports/:id/original',async(req,res)=>{const o=await repository().original(id(req.params.id));res.attachment(o.filename).send(o.buffer);});
app.get('/api/payroll',async(req,res)=>{const {from,to}=dates(req.query),{workers,entries}=await repository().data();res.json(summarize(workers,entries,from,to));});
app.get('/api/reports/pdf',async(req,res)=>{
  const {from,to}=dates(req.query);let {workers,entries}=await repository().data();const individual=!!req.query.workerId;
  if(individual){const w=id(req.query.workerId);workers=workers.filter(x=>x.id===w);entries=entries.filter(e=>e.worker_id===w);if(!workers.length)throw fail('Worker not found.',404);}
  pdfReport(res,workers,entries,from,to,individual);
});
app.get('/api/export',async(req,res)=>{const {workers,entries}=await repository().data();res.attachment('dev-technical-payroll.xlsx').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await excelReport(workers,entries)));});
app.get('/api/backup',async(req,res)=>{const {state,revision}=await getStore().read();res.attachment(`payroll-backup-${new Date().toISOString().slice(0,10)}.json`).type('application/json').send(JSON.stringify({format:'dts-payroll-backup',revision,state}));});
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found.'}));
if(!process.env.VERCEL){app.use(express.static(path.resolve('dist')));app.get('/{*splat}',(req,res)=>res.sendFile(path.resolve('dist/index.html')));}
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=err.status||(err.name==='ZodError'||err instanceof multer.MulterError?400:500);
  res.status(status).json({error:err.name==='ZodError'?err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):err instanceof multer.MulterError&&err.code==='LIMIT_FILE_SIZE'?'Workbook exceeds the 4 MB upload limit.':err.message});
});
