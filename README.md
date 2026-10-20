# Dev Technical Services — Payroll

A local React single-page payroll app with Tailwind CSS, Express and **MySQL 8**. The app is populated with the supplied workbook, not sample data.

## Open the app

While the server is running, open **http://127.0.0.1:3001**.

This workspace already has an isolated MySQL instance initialized under `.mysql/data`, on port **3307**. It does not change any existing MySQL service. The database is `dev_payroll`. Connection settings are in the ignored `.env` file; the local administrator credential is in ignored `private/mysql-admin.json`.

To restart after closing the app or restarting Windows:

```powershell
cd "D:\iyampoli\Work oke\Payroll"
powershell -ExecutionPolicy Bypass -File scripts/start-mysql.ps1
npm start
```

If MySQL is already running, skip the first command after `cd`. `npm start` serves the compiled SPA and API on the same port. Leave its terminal open. The MySQL log is `.mysql/server.log`.

For development:

```powershell
npm install
npm run dev
```

Vite serves the UI on port 5173 and proxies `/api` to port 3001. Build updated frontend code with `npm run build` before using `npm start`.

## Features

- Dashboard with selected-week wages, overtime, payments, working dates and cumulative outstanding payable.
- Add/edit/search workers and deactivate them without deleting their ledger.
- Work, off-day, payment-only and opening-advance entries.
- Individual salary and OT rates, live calculation preview, and server-side validation and calculation.
- Chronological worker ledgers with the source workbook's columns and a running balance.
- Monday–Sunday weekly payroll, including opening balance, period payments, closing balance and payable.
- Downloadable individual PDF payslips and combined weekly PDF reports.
- Excel import preview, atomic import, overlap rejection, exact-file duplicate detection and Excel export.
- Original workbook binary and source cell values/formulas retained in MySQL.
- Corrections and voids require a reason, preserve before/after history, and use version checks to reject stale edits.
- Mobile navigation, horizontally scrollable ledgers, labelled forms and keyboard-accessible dialogs.

## Workbook rules and source exceptions

The supplied workbook contains **8 workers and 246 substantive records**, including an opening advance. Date-only future rows, prefilled zero formulas and a summary total are not imported as transactions.

New workers default to **INR 1,300 per eight-hour day**. New entry overtime defaults to the worker's **full daily rate / 8**, so INR 1,300 produces **INR 162.50/hour**. Daily salary can be reduced for a half-day without changing the full-day overtime rate. An explicit OT rate can be entered.

Historical values remain as recorded:

- Several workers historically use INR 165/hour. These rates are preserved and flagged rather than rewritten.
- Rajan's INR 600 half-day salary is preserved; his base rate is INR 1,200.
- Riju's INR 15,000 opening advance dated 16 September 2026 is retained separately from the INR 4,000 payment that day.
- Navaneeth OH has 2.5 OT hours on 5 October 2026, a missing OT amount, and a recorded total of INR 1,000. The original total is preserved and flagged.
- Vineesh and Srejith OH have site entries on 19 October 2026 with missing salaries. They remain pending with **null earnings**, not invented wages. Their earnings are excluded until corrected.
- `Off`, `off`, `OFF` and `0ff` are treated as off days; source site text and notes are retained.
- There are **105 review rows**, largely historical-rate differences. Review notes are visible from the ledger and noted on PDFs.

Money is calculated with decimal arithmetic and rounded to paise per entry. Historical monetary values are stored as integer paise; rates use decimal columns. Blank historical earnings remain nullable.

**Running balance = cumulative earnings − cumulative advances/payments.** A negative balance means an advance to recover. The weekly opening balance includes all transactions before the week plus opening-advance records through the period end. Closing balance includes that opening balance and the week's net earnings. Amount payable is `max(0, closing balance)` per worker. Working days count distinct dates with positive salary; half-day entries count as one working date while retaining their actual wage.

Weekly reports are calculated from the current ledger; corrections are audited. They are not locked payroll snapshots.

## Imports and exports

Use **Reports & data → Import** and preview the file before importing. Required headers are `DATE`, `SAL`, `TOTAL` and `ADV/STMT`; the supplied layouts also include `SITE`, optional `TYPE`, `OT.HRS`, `OT. RATE`, `OT AMT`, and optional `Balance`. One sheet represents one worker.

Imports preserve cached formula values. They never execute spreadsheet macros or treat workbook text as instructions. Dates must be Excel date values or ISO date strings; opening advances use the source `Opening advance on dd.mm.yy` label. Unsupported layouts or overlapping worker/date/type entries reject the entire batch. Existing workers are matched by their sheet name; new workers use the modal positive historical salary as their base rate.

Excel export contains all non-voided records, original ledger column labels, running balances, notes and review flags. It is an exchange report, not a full database backup. Use the original-file download to retrieve an exact imported workbook.

CLI import:

```powershell
npm run import -- "C:\path\to\workbook.xlsx"
```

## Backups and data safety

```powershell
npm run backup
```

This creates a consistent MySQL SQL dump in `private/backups`, including workers, ledgers, audit history, and original imported workbook blobs. Copy backups to your normal protected backup storage. Keep `.env`, `private/`, and `.mysql/` private and out of source control. Do not copy a live MySQL data directory as a substitute for a consistent backup.

To restore, use MySQL's `mysql` client to load the SQL dump into a **new empty database**, then point `DB_NAME` at that database. A database administrator should review the target before restoring. Excel export alone cannot restore audit history.

The server binds to **127.0.0.1** and has no user login; it is intended for a trusted local workstation. Before exposing it to other computers or the internet, add authentication, HTTPS, access controls and managed backups. Do not simply change `HOST` to a public interface.

## Configure a different MySQL server

1. Create a database using `utf8mb4` and an application user permitted to create and access its tables.
2. Copy `.env.example` to `.env` and enter that connection configuration.
3. Run `npm install`, `npm run db:migrate`, `npm run build`, and `npm start`.
4. Import the workbook from the UI or CLI.

`scripts/setup-local.js` is a **one-time provisioning helper** for a fresh, isolated, passwordless MySQL instance on port 3307. It creates the database and application user, sets random passwords, and writes private configuration. It is not a restart command and must not be pointed at an existing business database.

## Verification

```powershell
npm test
npm run test:integration
npm run build
```

Unit tests cover overtime, half-day wages, paise rounding, invalid inputs and carry-forward balances. Integration tests create a uniquely named isolated MySQL database, load the original workbook from this installation, test transactions and HTTP operations, verify duplicate and overlapping imports roll back, exercise stale edit rejection and audit history, generate PDFs and read back the Excel export. The test database is dropped at the end; it does not add sample workers to the real payroll.

Integration tests require the local admin credential in `private/mysql-admin.json` and the first original workbook in `dev_payroll.imports`. Adapt that setup for CI or another installation.

## Main files

- `src/main.jsx`, `src/styles.css`: React interface and responsive styles.
- `server/domain.js`: validation, monetary calculations and payroll aggregation.
- `server/app.js`: Express API and download endpoints.
- `server/migrate.js`: MySQL schema.
- `server/workbook.js`, `server/import-service.js`: workbook parsing and transactional import.
- `server/reports.js`: PDF and Excel reports.
- `tests/`: calculation and MySQL integration checks.
