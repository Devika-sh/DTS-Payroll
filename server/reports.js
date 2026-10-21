import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { summarize, rupees } from './domain.js';
const cash = n => rupees(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function pdfReport(res, workers, entries, from, to, individual) {
  const doc = new PDFDocument({ size: 'A4', layout: individual ? 'portrait' : 'landscape', margin: 36, bufferPages: true });
  res.type('pdf').attachment(individual ? 'worker-payslip.pdf' : 'weekly-payroll.pdf');
  doc.pipe(res);
  const width = doc.page.width - 72;
  const title = individual ? `Payslip · ${workers[0].name}` : 'Weekly payroll';
  function heading() {
    doc.font('Helvetica-Bold').fontSize(17).fillColor('#155b49').text('DEV TECHNICAL SERVICES', 36, 34);
    doc.fontSize(13).fillColor('#152c25').text(title, 36, 60);
    doc.font('Helvetica').fontSize(9).fillColor('#64756d').text(`${from} to ${to}   |   All amounts in INR`, 36, 82);
    doc.moveTo(36, 103).lineTo(width + 36, 103).strokeColor('#d9e2dc').stroke();
    doc.y = 116;
  }
  heading();
  function table(headers, rows, widths) {
    const rowHeight = 28;
    const drawRow = (cells, isHead) => {
      if (doc.y > doc.page.height - 75) { doc.addPage(); heading(); drawRow(headers, true); }
      const y = doc.y;
      if (isHead) doc.rect(36, y, width, rowHeight).fill('#edf3ef');
      let x = 36;
      cells.forEach((c, i) => {
        doc.font(isHead ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#263d33')
          .text(String(c ?? '—'), x + 5, y + 8, { width: widths[i] - 10, height: rowHeight - 5, ellipsis: true });
        x += widths[i];
      });
      doc.moveTo(36, y + rowHeight).lineTo(width + 36, y + rowHeight).strokeColor('#e7ece8').stroke();
      doc.y = y + rowHeight;
    };
    drawRow(headers, true);
    rows.forEach(r => drawRow(r, false));
    doc.y += 14;
  }
  const summary = summarize(workers, entries, from, to);
  if (individual) {
    const s = summary[0];
    const metrics = [
      ['Working dates', s.days], ['Opening balance', cash(s.openingBalance)],
      ['Regular wages', cash(s.regular)], [`Overtime (${s.otHours} hours)`, cash(s.overtime)],
      ['Total earnings', cash(s.earnings)], ['Advances / payments', cash(s.advances)],
      ['Closing balance', cash(s.closing)], ['Amount payable', cash(s.payable)],
    ];
    table(['Description', 'Amount / count'], metrics, [width * .65, width * .35]);
    const list = entries.filter(e => !e.voided && e.entry_date >= from && e.entry_date <= to && e.kind !== 'opening');
    table(['Date', 'Site', 'Salary', 'OT', 'Total', 'Paid'], list.map(e => [e.entry_date, e.site,
      e.salary_cents == null ? 'Pending' : cash(e.salary_cents), e.ot_cents == null ? 'Pending' : cash(e.ot_cents),
      e.total_cents == null ? 'Pending' : cash(e.total_cents), cash(e.advance_cents)]),
      [80, 100, 80, 75, 90, width - 425]);
  } else {
    table(['Worker', 'Days', 'Wages', 'OT', 'Paid', 'Opening', 'Closing', 'Payable'],
      summary.map(s => [s.name,s.days,cash(s.regular),cash(s.overtime),cash(s.advances),cash(s.openingBalance),cash(s.closing),cash(s.payable)]),
      [130,40,95,90,95,105,105,width-660]);
    doc.fontSize(12).font('Helvetica-Bold').text(`Total payable: INR ${cash(summary.reduce((n,s) => n+s.payable,0))}`);
  }
  const pending = entries.filter(e => !e.voided && e.entry_date <= to && e.review_note);
  if (pending.length) {
    if (doc.y > doc.page.height - 120) { doc.addPage(); heading(); }
    doc.moveDown().font('Helvetica').fontSize(9).fillColor('#9b671d').text(
      `${pending.length} historical entries through the period end have review notes. Missing earnings are excluded; original historical amounts are retained. Review the ledger before payment.`,
      36, doc.y, { width });
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#738278').text(`Dev Technical Services  |  Payroll record  |  ${i + 1} / ${range.count}`, 36, doc.page.height - 42, { lineBreak: false });
  }
  doc.end();
}
export async function excelReport(workers, entries) {
  const book = new ExcelJS.Workbook();
  book.creator = 'Dev Technical Services';
  for (const w of workers) {
    let name = w.name.replace(/[\\/*?:[\]]/g, '').slice(0,31) || `Worker ${w.id}`;
    if (book.getWorksheet(name)) name = `${name.slice(0,24)} ${w.id}`;
    const sheet = book.addWorksheet(name);
    sheet.addRow(['DATE','SITE','TYPE','SAL','OT.HRS','OT. RATE','OT AMT','TOTAL','ADV/STMT','Balance','Review note','Notes']);
    let balance = 0;
    for (const e of entries.filter(e => e.worker_id === w.id && !e.voided)) {
      balance += Number(e.total_cents || 0) - Number(e.advance_cents);
      sheet.addRow([e.kind === 'opening' ? `Opening advance on ${e.entry_date.slice(8)}.${e.entry_date.slice(5,7)}.${e.entry_date.slice(2,4)}` : new Date(e.entry_date+'T00:00:00Z'),
        e.site,e.kind,e.salary_cents == null ? null : rupees(e.salary_cents),Number(e.ot_hours),Number(e.ot_rate),
        e.ot_cents == null ? null : rupees(e.ot_cents),e.total_cents == null ? null : rupees(e.total_cents),
        rupees(e.advance_cents),rupees(balance),e.review_note,e.notes]);
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'L1' };
    sheet.columns.forEach((c, i) => { c.width = i >= 10 ? 48 : i === 1 ? 18 : 15; if (i >= 3 && i <= 9) c.numFmt = '#,##0.00'; });
    sheet.getColumn(1).numFmt = 'dd-mmm-yyyy';
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF155B49' } };
    sheet.getRow(1).height = 26;
  }
  return book.xlsx.writeBuffer();
}
