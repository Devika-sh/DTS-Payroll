# Dev Technical Services — Payroll

React, Tailwind CSS and Express payroll SPA with **spreadsheet storage**. MySQL is no longer required.

- **Local:** an Excel workbook at `private/payroll.xlsx` stores workers, ledger entries, originals and audit history.
- **Vercel:** a private Google spreadsheet stores the same records through an authenticated Apps Script gateway. No database server or Google service-account key is needed.

## Run locally

Requires Node.js 22 or newer.

```powershell
npm ci
Copy-Item .env.example .env
npm run build
npm start
```

Open http://127.0.0.1:3001. On the existing workstation, keep the supplied `.env` and private workbook instead of copying over them. New installations begin empty. Use `npm run dev` for the React development server on port 5173.

## Spreadsheet storage

The local workbook has readable **Workers**, **Ledger**, **Audit**, and **Imports** tabs. These are review views; enter and correct records through the app. A hidden, checksummed state sheet retains complete audit snapshots, null earnings, source formulas, and imported workbook bytes, split into chunks to avoid Excel cell-size limits. Do not delete or edit technical sheets. Editing a review cell does not change the app's payroll data.

Writes use a cross-process lock, a temporary file and atomic replacement. The preceding version is retained as `payroll.xlsx.previous.xlsx`. Keep the storage workbook closed in Excel while the app is saving. After a process crash, if a stale `.lock` file prevents writes, stop **all** payroll server processes first, then remove only `private/payroll.xlsx.lock` and restart. Never remove an active lock.

The requested reset is now tracked in Git as migration `2026-10-21-clear-all-payroll-entries`. The first storage access after updating to this version clears **all existing entries**, including archived entries, plus their import records and entry-specific audit history. Workers remain. This runs for both local Excel storage and the configured Google spreadsheet. A persisted migration marker ensures later restarts, redeployments and Vercel instances preserve entries added after the reset. Back up an existing store before upgrading this version.

The current workstation has **eight workers and zero total entries**, including zero archived entries. Private recovery backups are excluded from GitHub. The prior MySQL data directory is retained separately as a recovery copy and is not used by the application. You can apply/check pending storage migrations explicitly with `npm run storage:migrate`. This command is idempotent; it does not repeat an already-applied reset.

## Connect Google Sheets for Vercel

This is a one-time manual setup in your Google account. No live Google spreadsheet has been connected or populated by this commit.

1. Create a new private Google spreadsheet for payroll. Copy its spreadsheet ID from the URL between `/d/` and `/edit`.
2. In that spreadsheet, open **Extensions → Apps Script**.
3. Replace the editor contents with `google-apps-script/Code.gs` from this repository and save it.
4. Open **Project Settings → Script properties** and add:

   | Property | Value |
   | --- | --- |
   | `PAYROLL_SPREADSHEET_ID` | The spreadsheet ID |
   | `PAYROLL_SECRET` | A random secret of at least 32 characters |

   Generate a secret locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it private; use the same value for the server's `SHEETS_SECRET`.
5. Select **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Authorize the script and copy its URL ending in `/exec`. The gateway rejects requests without your secret; the spreadsheet itself stays private. If your Workspace administrator disallows this deployment type, use a permitted Google account or a different storage host.
6. Deploy only **one gateway script project per spreadsheet**. Its script lock and revision checks serialize saves, and transaction IDs avoid duplicating a save after a lost response. An inactive snapshot is verified before its manifest is switched, preserving the previous complete version.
7. Visible Google tabs are read-only review views updated after saves. All app reads use the committed snapshot. If projection refresh fails, the app data remains committed; use the app's current ledger and make another save after resolving Sheets quotas/access issues. Avoid manual changes to the hidden `_DTS_*` sheets.

Google Apps Script setup references: [web apps](https://developers.google.com/apps-script/guides/web), [script properties](https://developers.google.com/apps-script/guides/properties), and [locks](https://developers.google.com/apps-script/reference/lock/lock-service).

## Deploy from GitHub to Vercel

The repository includes the full frontend/server source, `api/index.js`, and `vercel.json`.

1. Push this commit to GitHub.
2. In Vercel choose **Add New → Project** and import `Devika-sh/DTS-Payroll`.
3. Use the repository root, framework **Vite**, install command `npm ci`, build command `npm run build`, and output directory `dist`. Vercel runs the Express API through the API entry point; it does not run `npm start`.
4. Add these server environment variables for **Production**:

   ```dotenv
   STORAGE_MODE=google-sheets
   SHEETS_WEB_APP_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
   SHEETS_SECRET=the-same-secret-as-PAYROLL_SECRET
   APP_ORIGINS=https://your-project.vercel.app
   ```

   Use the exact origin, without a trailing slash. Multiple trusted domains can be comma-separated. Configure a separate spreadsheet and variables for previews so test deployments cannot change production payroll. Never prefix secrets with `VITE_`.
5. Enable **Settings → Deployment Protection → All Deployments → Vercel Authentication** before adding payroll data. The app has no built-in user login. Standard Protection can leave production domains publicly accessible; verify in a signed-out browser. For independent staff access, implement application authentication and permissions.
6. Click **Deploy**. If necessary, correct `APP_ORIGINS` to match the assigned URL, then redeploy.
7. Open `/api/health`; expect `{"storage":"google-sheets","status":"connected"}`. Create a worker, save an entry, refresh, and verify its ledger, PDF and Excel export.

There are **no DB_* variables, schema migrations, or MySQL setup steps**. Vercel deployments explicitly refuse local Excel storage because deployment-local writes cannot be relied on for durable records.

### Copy your existing local records to Google Sheets

The new cloud spreadsheet starts empty. To copy the current workstation's workers and preserved history, create an ignored `.env.sheets.local` with `SHEETS_WEB_APP_URL`, `SHEETS_SECRET` and `PAYROLL_FILE=private/payroll.xlsx`, then run:

```powershell
node --env-file=.env.sheets.local scripts/sheets-upload.js
```

The upload refuses any nonempty destination. It preserves the reset state and archived history. It does not re-import the original workbook as active payroll. After the transfer, use one authoritative store: the deployed app with Google Sheets. Local Excel and Google Sheets do not automatically synchronize.

## Payroll rules and features

- Workers have individual base wages; new workers default to INR 1,300 per eight-hour day.
- New OT defaults to the full daily rate divided by eight: INR 162.50/hour for INR 1,300/day. A half-day salary can be entered without reducing the base OT rate. Explicit recorded OT rates are retained.
- Money uses decimal arithmetic, rounded to paise per entry. Balances equal earnings minus payments; negative balances represent advances to recover.
- Monday–Sunday payroll includes opening balance, regular wages, OT, period payments, closing balance and payable. Payable is `max(0, closing)` per worker. Working days count distinct dates with positive salary.
- Corrections and voids require a reason and retain before/after records. Stale corrections are rejected.
- Historical source amounts are preserved and flagged rather than silently recalculated. Missing salaries remain null and excluded from earnings until corrected.
- Worker ledgers, original-workbook downloads, Excel import preview/export, individual PDF payslips and combined weekly PDFs remain available.

## Import, export, backup and restore

Use **Reports & data** to import an `.xlsx` file, preview exceptions, export ledgers, or download a full backup. Imports expect one worker per sheet with `DATE`, `SITE`, `SAL`, `OT.HRS`, `OT. RATE`, `OT AMT`, `TOTAL`, `ADV/STMT` and optional `TYPE`, `Balance`, notes. Blank future dates are skipped. Opening advances use `Opening advance on dd.mm.yy`. All-or-nothing imports reject exact-file duplicates and overlapping daily records.

The upload limit is **4 MB** because Vercel Functions limit request payload size. Larger imports need a separate file-upload flow. Large backup/original downloads can also encounter hosting response limits. This spreadsheet design targets a small payroll workspace, not unlimited data or high write volume; Sheets/Apps Script quotas and workbook rewrite time apply.

```powershell
npm run import -- "C:\path\to\workbook.xlsx"
npm run backup
```

The CLI reads the configured storage mode. Full backups are JSON files under ignored `private/backups`, including originals, voided records and audit history. Excel ledger export is a report, not a full recovery backup.

To restore into a **new empty destination**, configure `PAYROLL_FILE` to a new workbook path or connect an empty Google spreadsheet, then run:

```powershell
npm run restore -- "C:\path\to\payroll-backup.json"
```

The restore refuses nonempty destinations. Retain protected external backups and test recovery. Never commit `.env`, `.env.*` (except `.env.example`), `private`, backups or payroll workbooks. Any credentials previously committed to GitHub should be rotated; removing a file from the latest commit does not remove historical versions.

## Verification

```powershell
npm test
npm run test:integration
npm run build
```

Tests cover wage calculations, half-days, missing earnings, carry-forwards, local concurrent writers, rollback on failure, reopen persistence, corruption detection, stale revisions, duplicate transaction recovery, formula-safe Google review cells, HTTP operations, imports, audits, backups, PDFs and Excel export. Google gateway tests use the actual Apps Script source with a mocked Google runtime; live Google authorization/deployment requires the account setup above and is not claimed as verified.
