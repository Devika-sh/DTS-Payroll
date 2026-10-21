import Decimal from 'decimal.js';
import { z } from 'zod';

export const money = value => new Decimal(value || 0).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
export const rupees = cents => Number(cents || 0) / 100;
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}, 'Invalid calendar date');
const amount = z.coerce.number().finite().min(0).max(10000000);
const centsAmount = amount.refine(n => new Decimal(n).decimalPlaces() <= 2, 'Use at most two decimal places.');
export const workerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  dailyRate: amount.gt(0).refine(n => new Decimal(n).decimalPlaces() <= 2, 'Use at most two decimal places.').default(1300),
  phone: z.string().trim().max(30).default(''),
  active: z.boolean().default(true),
});
export const entrySchema = z.object({
  workerId: z.coerce.number().int().positive(),
  date: dateSchema,
  site: z.string().trim().max(100).default(''),
  type: z.enum(['work', 'off', 'payment', 'opening']).default('work'),
  salary: centsAmount.default(0),
  otHours: z.coerce.number().finite().min(0).max(24).refine(n => new Decimal(n).decimalPlaces() <= 2, 'Use at most two decimal places.').default(0),
  otRate: amount.refine(n => new Decimal(n).decimalPlaces() <= 4, 'Use at most four decimal places.').optional(),
  advance: centsAmount.default(0),
  notes: z.string().max(2000).default(''),
  version: z.number().int().positive().optional(),
  reason: z.string().trim().max(500).default(''),
});
export function calculate(input, dailyRate) {
  const e = entrySchema.parse(input);
  const rate = e.otRate ?? new Decimal(dailyRate).div(8).toNumber();
  const salary = e.type === 'work' ? money(e.salary) : 0;
  const hours = e.type === 'work' ? e.otHours : 0;
  const overtime = money(new Decimal(hours).mul(rate));
  if (e.type === 'work' && !e.site) throw new Error('A work site is required.');
  if (['payment', 'opening'].includes(e.type) && e.advance <= 0) throw new Error('Enter a payment amount.');
  return { ...e, salaryCents: salary, otHours: hours, otRate: rate, otCents: overtime, totalCents: salary + overtime, advanceCents: money(e.advance) };
}
export function summarize(workers, entries, from, to) {
  return workers.map(w => {
    const all = entries.filter(e => e.worker_id === w.id && !e.voided && e.entry_date <= to);
    const period = all.filter(e => e.entry_date >= from && e.kind !== 'opening');
    const opening = all.filter(e => e.entry_date < from || e.kind === 'opening');
    const sum = (list, key) => list.reduce((s, e) => s + Number(e[key] || 0), 0);
    const openingBalance = sum(opening, 'total_cents') - sum(opening, 'advance_cents');
    const regular = sum(period, 'salary_cents'), overtime = sum(period, 'ot_cents');
    const earnings = sum(period, 'total_cents'), advances = sum(period, 'advance_cents');
    const closing = openingBalance + earnings - advances;
    return { ...w, days: new Set(period.filter(e => e.kind === 'work' && e.salary_cents > 0).map(e => e.entry_date)).size,
      otHours: sum(period, 'ot_hours'), regular, overtime, earnings, advances,
      openingBalance, net: earnings - advances, closing, payable: Math.max(0, closing),
      review: period.filter(e => e.review_note).length };
  });
}
