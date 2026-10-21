import { closeStore } from './storage/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importWorkbook } from './import-service.js';
try {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run import -- "path/to/workbook.xlsx"');
  const r = await importWorkbook(await fs.readFile(file), path.basename(file));
  console.log(JSON.stringify({ id: r.id, workers: r.workers, rows: r.rows, reviewRows: r.warnings.length, skipped: r.skipped }, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await closeStore(); }
