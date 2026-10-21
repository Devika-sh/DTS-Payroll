import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

test('Spreadsheet-backed HTTP payroll, transactional imports, audit history, backup, PDFs and Excel',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'payroll-api-'));
  process.env.STORAGE_MODE='excel';process.env.PAYROLL_FILE=path.join(dir,'payroll.xlsx');delete process.env.VERCEL;
  const {app}=await import('../server/app.js');
  let server;
  try{
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const call=async(url,body,method='POST')=>{const response=await fetch(base+'/api'+url,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
    assert.equal((await call('/health',null,'GET')).data.storage,'excel');
    const w=(await call('/workers',{name:'Test worker',dailyRate:1300})).data.id;
    const input={workerId:w,date:'2026-10-20',site:'SBLA',salary:1300,otHours:2,advance:500};
    const created=await call('/entries',input);assert.equal(created.status,201);
    const concurrent=await Promise.all([call('/entries',input),call('/entries',input)]);assert.ok(concurrent.every(r=>r.status===409));
    const payroll=await call('/payroll?from=2026-10-19&to=2026-10-25',null,'GET');
    assert.equal(payroll.data[0].earnings,162500);assert.equal(payroll.data[0].closing,112500);
    await call(`/workers/${w}`,{name:'Test worker',dailyRate:1500},'PUT');
    assert.equal((await call('/payroll?from=2026-10-19&to=2026-10-25',null,'GET')).data[0].earnings,162500);
    const edit={...input,otRate:162.5,otHours:3,version:1,reason:'Correct attendance'};
    assert.equal((await call(`/entries/${created.data.id}`,edit,'PUT')).status,200);
    assert.equal((await call(`/entries/${created.data.id}`,edit,'PUT')).status,409);
    assert.equal((await call(`/entries/${created.data.id}/history`,null,'GET')).data.length,2);
    for(const suffix of ['',`&workerId=${w}`]){
      const response=await fetch(base+'/api/reports/pdf?from=2026-10-19&to=2026-10-25'+suffix);
      assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,4).toString(),'%PDF');
    }
    const exported=new ExcelJS.Workbook();await exported.xlsx.load(Buffer.from(await (await fetch(base+'/api/export')).arrayBuffer()));
    assert.equal(exported.worksheets[0].getRow(2).getCell(8).value,1787.5);
    const backup=await call('/backup',null,'GET');assert.equal(backup.data.state.entries.length,1);assert.ok(backup.data.state.audit.length>=3);
    assert.equal((await call(`/entries/${created.data.id}/void`,{version:2,reason:'Void duplicate source'})).status,200);
    assert.equal((await call('/payroll?from=2026-10-19&to=2026-10-25',null,'GET')).data[0].closing,0);
    assert.equal((await call('/entries',{...input,date:'2026-02-30'})).status,400);
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Imported worker');
    sheet.addRow(['DATE','SITE','SAL','OT.HRS','OT. RATE','OT AMT','TOTAL','ADV/STMT']);
    sheet.addRow(['Opening advance on 16.09.26',null,null,null,null,null,null,15000]);
    sheet.addRow([new Date('2026-09-17T00:00:00Z'),'SBLA',1300,2,165,330,1630,500]);
    sheet.addRow([new Date('2026-09-18T00:00:00Z'),'SBLA',650,0,165,0,650,0]);
    sheet.addRow([new Date('2026-09-19T00:00:00Z'),'SBLA']);
    sheet.addRow([new Date('2026-09-20T00:00:00Z')]);
    const buffer=Buffer.from(await workbook.xlsx.writeBuffer());
    const upload=async(route,bytes)=>{const body=new FormData();body.append('file',new Blob([bytes]),'original.xlsx');const response=await fetch(base+'/api'+route,{method:'POST',body});return {status:response.status,data:await response.json()};};
    assert.equal((await upload('/import/preview',buffer)).data.rows,4);
    const imported=await upload('/import',buffer);assert.equal(imported.status,201);
    assert.equal((await upload('/import',buffer)).status,409);
    workbook.creator='Byte-different overlap';assert.equal((await upload('/import',await workbook.xlsx.writeBuffer())).status,409);
    const all=(await call('/data',null,'GET')).data;assert.equal(all.imports.length,1);assert.equal(all.entries.length,5);
    assert.equal(all.entries.filter(e=>e.total_cents==null).length,1);
    const original=await fetch(base+`/api/imports/${imported.data.id}/original`);assert.deepEqual(Buffer.from(await original.arrayBuffer()),buffer);
    const originResponse=await fetch(base+'/api/workers',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:JSON.stringify({name:'Bad origin'})});assert.equal(originResponse.status,403);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
