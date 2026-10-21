import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, money, summarize, dateSchema } from '../server/domain.js';

test('default 1300 / 8 overtime and fractional hours use paise rounding',()=>{
  const e=calculate({workerId:1,date:'2026-10-20',site:'SBLA',salary:1300,otHours:1.5,advance:200},1300);
  assert.equal(e.otRate,162.5);
  assert.equal(e.otCents,24375);
  assert.equal(e.totalCents,154375);
  assert.equal(e.advanceCents,20000);
  assert.equal(money('1.005'),101);
});
test('half-day wage retains the full-day overtime rate and explicit zero is valid',()=>{
  const e=calculate({workerId:1,date:'2026-10-20',site:'SBLA',salary:600,otHours:2},1200);
  assert.equal(e.otRate,150);
  assert.equal(e.totalCents,90000);
  const off=calculate({workerId:1,date:'2026-10-20',type:'off',salary:1300,otHours:3,advance:500},1300);
  assert.equal(off.totalCents,0);
  assert.equal(off.advanceCents,50000);
});
test('invalid dates, negative amounts, and excessive hours are rejected',()=>{
  assert.throws(()=>dateSchema.parse('2026-02-30'));
  for(const change of [{salary:-1},{otHours:25},{advance:-10}])
    assert.throws(()=>calculate({workerId:1,date:'2026-10-20',site:'A',salary:1300,...change},1300));
});
test('weekly balances include opening advances, exclude voids and preserve missing earnings',()=>{
  const w=[{id:1,name:'Worker'}];
  const e=[
    {worker_id:1,entry_date:'2026-09-16',kind:'opening',total_cents:0,advance_cents:1500000},
    {worker_id:1,entry_date:'2026-09-19',kind:'work',salary_cents:130000,total_cents:130000,advance_cents:0},
    {worker_id:1,entry_date:'2026-09-21',kind:'work',salary_cents:65000,total_cents:97500,ot_cents:32500,ot_hours:2,advance_cents:20000},
    {worker_id:1,entry_date:'2026-09-22',kind:'work',salary_cents:null,total_cents:null,advance_cents:10000,review_note:'Missing salary'},
    {worker_id:1,entry_date:'2026-09-23',kind:'work',total_cents:999999,voided:true},
    {worker_id:1,entry_date:'2026-10-01',kind:'work',total_cents:999999},
  ];
  const s=summarize(w,e,'2026-09-21','2026-09-27')[0];
  assert.equal(s.days,1);
  assert.equal(s.openingBalance,-1370000);
  assert.equal(s.net,67500);
  assert.equal(s.closing,-1302500);
  assert.equal(s.payable,0);
  assert.equal(s.review,1);
});
