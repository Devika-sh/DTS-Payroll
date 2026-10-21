# Dev Technical Services — Payroll

React, Tailwind CSS and Express payroll app using **MongoDB by default**, both locally and on Vercel. Excel imports, exports, original downloads, PDF payslips, audit history and JSON backups remain available.

## Connect MongoDB Atlas

1. Create a project and cluster in [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Under **Database & Network Access**, create a **database user** with `readWrite` access to the `dts_payroll` database. This is separate from your Atlas sign-in account.
3. Add your computer's public IP to the project's IP access list. For deployment, also allow your server's outbound IP addresses. Vercel needs a network configuration whose outbound addresses Atlas permits; allowing only your laptop IP will not allow Vercel to connect. Prefer fixed outbound addresses and a restricted access list. An allow-all entry (`0.0.0.0/0`) exposes the database endpoint to the internet and should not be the default for payroll data.
4. In the cluster, select **Connect → Drivers → Node.js** and copy the connection string. Replace the username/password placeholders; URL-encode special characters in either value. Keep the URI private.
5. Install Node.js 22 or newer and run `npm ci` in this repository. On a new installation, copy `.env.example` to `.env`. If `.env` already exists, edit it without overwriting other settings:

   ```dotenv
   STORAGE_MODE=mongodb
   MONGODB_URI=mongodb+srv://USERNAME:ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB=dts_payroll
   APP_ORIGINS=http://127.0.0.1:3001,http://localhost:5173
   PORT=3001
   HOST=127.0.0.1
   ```

6. Run `npm run build`, then `npm start`. Open http://127.0.0.1:3001. For development use `npm run dev` and the Vite URL printed in the terminal.
7. Visit http://127.0.0.1:3001/api/health. Expected result: `{"storage":"mongodb","status":"connected"}`. Create a worker, refresh, and verify it remains saved. The database and `payroll_state` collection are created on the first write.

For a locally installed MongoDB server, use `MONGODB_URI=mongodb://127.0.0.1:27017` instead. MongoDB must be running; installing npm dependencies does not install a production database server.

Official references: [Atlas connection setup](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/), [IP access lists](https://www.mongodb.com/docs/atlas/security/ip-access-list/), and [Node.js connection pools](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/connection-pools/).

## Copy existing payroll records

Changing configuration does not automatically copy data. MongoDB starts empty. Stop payroll edits during transfer and keep a protected backup of the existing source.

With the destination MongoDB variables configured in `.env`, copy the existing local workbook:

```powershell
npm run mongodb:upload -- excel
```

The source defaults to `private/payroll.xlsx`; set `PAYROLL_FILE` if needed. To copy Google Sheets instead, retain `SHEETS_WEB_APP_URL` and `SHEETS_SECRET` in `.env`, then run:

```powershell
npm run mongodb:upload -- google-sheets
```

The command refuses a nonempty destination and copies workers, entries (including voided entries), originals, audits and migration markers. It reads the source without running the old entry-reset migration and leaves the source unchanged. MongoDB never runs that historical destructive reset. Verify counts and reports after transfer, then use MongoDB as the authoritative store; stores do not synchronize.

Legacy `STORAGE_MODE=excel` and `STORAGE_MODE=google-sheets` remain available for recovery/transition. Those legacy modes still run their existing versioned reset migration if its marker is missing. Use the transfer command above to preserve a source without applying that reset. Excel storage is rejected on Vercel.

## Deploy from GitHub to Vercel

1. Import `Devika-sh/DTS-Payroll` into Vercel. Use framework **Vite**, repository root, install command `npm ci`, build command `npm run build`, and output directory `dist`. The included `api/index.js` and `vercel.json` route API requests to Express.
2. Set these server environment variables in Vercel:

   ```dotenv
   STORAGE_MODE=mongodb
   MONGODB_URI=your-private-Atlas-connection-string
   MONGODB_DB=dts_payroll
   APP_ORIGINS=https://your-project.vercel.app
   ```

   Replace or remove the previous `STORAGE_MODE=google-sheets` setting. Use the exact app origin without a trailing slash; multiple trusted origins can be comma-separated. Never prefix database secrets with `VITE_`. Configure separate databases and database users for previews.
3. Permit the deployment's outbound network addresses in Atlas. Enable deployment access protection before entering payroll: this app does not implement user login. Verify the production URL is protected in a signed-out browser.
4. Deploy or redeploy after changing environment variables. Check `/api/health` for `mongodb` and `connected`, then verify a save, refresh, PDF and Excel export.

If connection fails, check database user credentials, percent-encoding, the cluster hostname, network access and environment variable scope. An empty app usually means a different `MONGODB_DB` was selected or the old records have not been transferred. Do not share `.env` or your connection string in screenshots or GitHub.

## Storage behavior and limits

A pooled MongoDB client is reused per server instance. The `payroll_state` collection holds one document containing workers, ledger entries, imports and audits. Each mutation atomically replaces the document only if its revision still matches, preventing lost updates across processes. Conflicts retry against the latest state; failed operations leave the prior data intact. Transaction identifiers let the app recognize a successful save if its response is lost.

This preserves the existing small-workspace repository semantics without requiring multi-document transactions or a replica set for local development. It is not a normalized collection-per-entity design. A 15 MiB document safety limit rejects growth before MongoDB's 16 MiB document limit, including embedded original workbooks and audit history. For larger datasets, move originals to object storage and split records into collections with transactional writes. Keep external backups; do not edit the storage document manually.

## Payroll and recovery

Workers have individual daily wages, defaulting to INR 1,300 for eight hours. Default OT is daily wage divided by eight. Decimal arithmetic, paise rounding, weekly carry-forward balances, reason-required corrections, stale-version rejection, voids, source amounts and missing salary handling are unchanged.

Import `.xlsx` workbooks through **Reports & data**. Imports expect one worker per sheet with `DATE`, `SITE`, `SAL`, `OT.HRS`, `OT. RATE`, `OT AMT`, `TOTAL`, `ADV/STMT` and optional `TYPE`, `Balance`, notes. Uploads are limited to 4 MB. Hosting response limits can also affect large backups or downloads.

```powershell
npm run import -- "C:\path\to\workbook.xlsx"
npm run backup
npm run restore -- "C:\path\to\payroll-backup.json"
```

Backups are JSON files under ignored `private/backups`, including originals and audit history. Restore requires an empty destination; select a new `MONGODB_DB` first. Excel export is a report, not a full recovery backup. Never commit `.env`, private workbooks or backups.

## Verification

```powershell
npm test
npm run test:integration
npm run test:mongodb
npm run build
```

`test:mongodb` starts a temporary real MongoDB server and checks concurrent writes, rollback, uncertain-write recovery, size rejection, preserved records and the complete HTTP payroll flow. Its first run downloads a MongoDB test binary and requires network access. The ordinary integration suite uses an isolated temporary Excel file. No production database is used by these tests. Atlas credentials and deployment network access must still be configured and checked by the account owner.
