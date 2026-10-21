import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { money, dateSchema } from './domain.js';

const value = cell => {
  const v = cell.value;
  if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) return v.result ?? null;
  if (v?.richText) return v.richText.map(t => t.text).join('');
  return v;
};
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
export async function parseWorkbook(buffer) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const workers = [], warnings = [];
  let skipped = 0;
  for (const sheet of book.worksheets) {
    const columns = {};
    sheet.getRow(1).eachCell((c, i) => { columns[norm(value(c))] = i; });
    if (!columns.DATE || !columns.SAL || !columns.ADVSTMT || !columns.TOTAL) throw new Error(`Sheet "${sheet.name}" has unsupported headers. Expected DATE, SITE, SAL, OT.HRS, OT. RATE, OT AMT, TOTAL, ADV/STMT.`);
    const rows = [];
    const read = (r, key) => columns[key] ? value(r.getCell(columns[key])) : null;
    for (let i = 2; i <= sheet.rowCount; i++) {
      const r = sheet.getRow(i), rawDate = read(r, 'DATE');
      const site = String(read(r, 'SITE') ?? '').trim();
      const sal = read(r, 'SAL'), hours = read(r, 'OTHRS'), advance = read(r, 'ADVSTMT');
      const opening = typeof rawDate === 'string' && /opening advance/i.test(rawDate);
      // Date-only rows and formulas pre-filled into future rows are placeholders.
      if (!opening && !site && sal == null && !hours && !advance) { skipped++; continue; }
      let date;
      if (opening) {
        const match = rawDate.match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
        if (!match) throw new Error(`${sheet.name} row ${i}: opening advance needs a date.`);
        date = `${match[3].length === 2 ? '20' : ''}${match[3]}-${match[2]}-${match[1]}`;
      } else if (rawDate instanceof Date && !isNaN(rawDate)) date = rawDate.toISOString().slice(0, 10);
      else if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) date = rawDate;
      else throw new Error(`${sheet.name} row ${i}: unrecognized date.`);
      dateSchema.parse(date);
      const notes = [];
      const numeric = (v, name, fallback = 0) => {
        if (v == null || v === '') return fallback;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${sheet.name} row ${i}: invalid ${name}.`);
        return v;
      };
      const off = /^(off|0ff)$/i.test(site);
      const explicitKind = String(read(r, 'TYPE') || '').toLowerCase();
      const kind = opening ? 'opening' : ['work','off','payment'].includes(explicitKind) ? explicitKind : off ? 'off' : sal == null && !site && advance ? 'payment' : 'work';
      const salary = opening ? 0 : numeric(sal, 'salary', kind === 'work' ? null : 0);
      const otHours = numeric(hours, 'OT hours');
      const otRate = numeric(read(r, 'OTRATE'), 'OT rate');
      const rawOt = read(r, 'OTAMT'), rawTotal = read(r, 'TOTAL');
      let ot = numeric(rawOt, 'OT amount');
      let total = numeric(rawTotal, 'total', salary == null ? null : salary + ot);
      if (salary == null) notes.push('Salary is missing. Earnings are excluded until reviewed.');
      if (otHours && rawOt == null) notes.push('OT hours exist but OT amount is missing. Original total preserved.');
      if (otHours && money(ot) !== money(otHours * otRate)) notes.push('OT amount differs from hours × rate. Original amount preserved.');
      if (salary != null && total != null && money(total) !== money(salary + ot)) notes.push('Total differs from salary + overtime. Original total preserved.');
      if (salary > 0 && otRate > 0 && Math.abs(otRate - salary / 8) > .001) notes.push('Historical OT rate differs from salary ÷ 8; preserved.');
      const raw = {};
      r.eachCell((c) => { if (c.value != null) raw[c.address] = c.value; });
      const extra = [];
      r.eachCell((c, j) => { if (!Object.values(columns).includes(j) && value(c) != null) extra.push(`${c.address}: ${value(c)}`); });
      const entry = { date, site: opening ? '' : site, kind, salaryCents: salary == null ? null : money(salary),
        otHours, otRate, otCents: salary == null ? null : money(ot), totalCents: salary == null ? null : money(total),
        advanceCents: money(numeric(advance, 'advance')), notes: [read(r, 'TYPE'), read(r, 'NOTES'), ...extra].filter(Boolean).join('; '),
        reviewNote: [...new Set([...notes, read(r,'REVIEWNOTE')].filter(Boolean))].join(' '), source: { sheet: sheet.name, row: i, cells: raw } };
      rows.push(entry);
      if (notes.length) warnings.push({ worker: sheet.name, row: i, date, message: entry.reviewNote });
    }
    const rates = rows.filter(r => r.salaryCents > 0).map(r => r.salaryCents / 100);
    // The modal full-day salary keeps half-day payments from changing a worker's base rate.
    const counts = new Map();
    rates.forEach(r => counts.set(r, (counts.get(r) || 0) + 1));
    const rate = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 1300;
    workers.push({ name: sheet.name, dailyRate: rate, rows });
  }
  if (!workers.length) throw new Error('No worker sheets were found.');
  return { hash: createHash('sha256').update(buffer).digest('hex'), workers, warnings, skipped,
    rowCount: workers.reduce((n, w) => n + w.rows.length, 0) };
}
