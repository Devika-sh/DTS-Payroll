import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {LocalSpreadsheetStore} from '../server/storage/local.js';
import {GoogleSpreadsheetStore} from '../server/storage/google.js';
import {emptyState,encodeState,digest,reviewTables} from '../server/storage/state.js';
import {PayrollRepository} from '../server/repository.js';
import {createStore} from '../server/storage/index.js';

test('Excel storage survives reopen, serializes writers, and rolls back failed mutations',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'payroll-storage-'));
  try{
    const filename=path.join(dir,'payroll.xlsx');const store=new LocalSpreadsheetStore(filename);
    assert.equal((await store.read()).revision,0);
    const repo=new PayrollRepository(store);
    await Promise.all(Array.from({length:8},(_,i)=>repo.createWorker({name:'Worker '+i,dailyRate:1300})));
    const reopened=new LocalSpreadsheetStore(filename);
    assert.equal((await reopened.read()).state.workers.length,8);
    assert.equal((await reopened.read()).revision,8);
    await assert.rejects(reopened.mutate(state=>{state.workers.length=0;throw new Error('Abort');}),/Abort/);
    assert.equal((await reopened.read()).state.workers.length,8);
    assert.ok((await fs.stat(filename+'.previous.xlsx')).size>0);
    await fs.writeFile(filename,'corrupt');await assert.rejects(reopened.read(),/Cannot read/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Vercel refuses ephemeral Excel storage and requires configured MongoDB',()=>{
  assert.throws(()=>createStore({VERCEL:'1',STORAGE_MODE:'excel'}),/not durable/);
  assert.throws(()=>createStore({VERCEL:'1'}),/Configure MONGODB_URI/);
});

async function gateway(){
  const sheets=new Map();
  function sheet(name){
    const cells=new Map();
    const obj={name,cells,getMaxRows:()=>100000,getMaxColumns:()=>30,clearContents(){cells.clear();return obj;},setFrozenRows(){return obj;},hideSheet(){return obj;},
      getRange(r,c,rows=1,cols=1){
        const range={getValue:()=>cells.get(`${r},${c}`)||'',setValue(v){cells.set(`${r},${c}`,v);return range;},
          getValues:()=>Array.from({length:rows},(_,i)=>Array.from({length:cols},(_,j)=>cells.get(`${r+i},${c+j}`)??'')),
          setValues(values){values.forEach((row,i)=>row.forEach((v,j)=>cells.set(`${r+i},${c+j}`,v)));return range;},
          setBackground(){return range;},setFontColor(){return range;},setFontWeight(){return range;},setNote(){return range;}};return range;
      }};return obj;
  }
  const book={getSheetByName:name=>sheets.get(name),insertSheet(name){const s=sheet(name);sheets.set(name,s);return s;}};
  const secret='s'.repeat(48);let held=false;
  const context=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:name=>name==='PAYROLL_SECRET'?secret:'spreadsheet-id'})},
    LockService:{getScriptLock:()=>({tryLock:()=>{assert.equal(held,false);held=true;return true;},releaseLock:()=>{held=false;}})},
    SpreadsheetApp:{openById:()=>book,flush:()=>{}},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(algorithm,data)=>[...createHash(algorithm).update(data).digest()]},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>text})},
  });
  vm.runInContext(await fs.readFile('google-apps-script/Code.gs','utf8'),context);
  const call=payload=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({...payload,secret:payload.secret||secret})}}));
  const request=async(url,options)=>{const data=call(JSON.parse(options.body));return {ok:true,json:async()=>data};};
  return {call,request,secret,sheets};
}
test('Apps Script commits checksum snapshots, rejects stale revisions, and deduplicates retries',async()=>{
  const g=await gateway();
  assert.equal(g.call({action:'read',secret:'wrong'}).status,401);
  assert.equal(g.call({action:'read'}).revision,0);
  const state=emptyState();state.workers.push({id:1,name:'=not-a-formula',daily_rate:1300,phone:'',active:true});
  const data=encodeState(state);
  const payload={action:'commit',expectedRevision:0,transactionId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',data,digest:digest(data),tables:reviewTables(state)};
  assert.equal(g.call(payload).revision,1);
  assert.equal(g.call(payload).revision,1);
  assert.equal(g.call({...payload,transactionId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}).status,409);
  assert.equal(g.call({action:'read'}).data,data);
  assert.equal(g.sheets.get('Workers').cells.get('2,2'),"'=not-a-formula");
  assert.equal(g.call({...payload,expectedRevision:1,transactionId:'cccccccc-cccc-cccc-cccc-cccccccccccc',digest:'bad'}).ok,false);
  assert.equal(g.call({action:'read'}).revision,1);
});
test('Google driver retries a conflicting save and recognizes a committed save after a lost response',async()=>{
  const g=await gateway();let injected=false;
  const request=async(url,options)=>{
    const p=JSON.parse(options.body);
    if(p.action==='commit'&&!injected){injected=true;return {ok:true,json:async()=>({ok:false,status:409,error:'Conflict'})};}
    const response=await g.request(url,options);
    if(p.action==='commit')throw new Error('Response lost after commit');
    return response;
  };
  const store=new GoogleSpreadsheetStore('https://script.google.com/macros/s/test/exec',g.secret,request);
  const repo=new PayrollRepository(store);
  await repo.createWorker({name:'Cloud worker',dailyRate:1300});
  assert.equal((await repo.data()).workers.length,1);
  assert.equal((await store.read()).revision,1);
});
