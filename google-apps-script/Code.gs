/** DTS Payroll spreadsheet gateway. Deploy as a Web App, executing as yourself.
 * Script properties: PAYROLL_SPREADSHEET_ID and PAYROLL_SECRET (32+ random chars).
 * Use the same spreadsheet with one gateway deployment only.
 * Update records through the payroll app; visible tabs are read-only review views.
 */
function doPost(e) {
  var lock = null;
  try {
    var request = JSON.parse(e.postData.contents);
    var properties = PropertiesService.getScriptProperties();
    var expected = properties.getProperty('PAYROLL_SECRET');
    if (!expected || expected.length < 32 || !sameSecret_(expected, request.secret)) return json_({ok:false,status:401,error:'Invalid spreadsheet gateway credentials.'});
    var spreadsheetId = properties.getProperty('PAYROLL_SPREADSHEET_ID');
    if (!spreadsheetId) throw new Error('Configure PAYROLL_SPREADSHEET_ID.');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ok:false,status:503,error:'Spreadsheet busy. Please retry.'});
    var book = SpreadsheetApp.openById(spreadsheetId);
    var metaSheet = book.getSheetByName('_DTS_Meta');
    var rawMeta = metaSheet ? metaSheet.getRange(1,1).getValue() : '';
    var meta = rawMeta ? JSON.parse(rawMeta) : {revision:0,slot:'B',commits:[]};
    if (request.action === 'read') {
      if (!meta.revision) return json_({ok:true,revision:0,commits:[]});
      var sheet = book.getSheetByName('_DTS_' + meta.slot);
      if (!sheet) throw new Error('Payroll snapshot is missing. Restore a backup.');
      var data = sheet.getRange(1,1,meta.chunks,1).getValues().map(function(row){return row[0];}).join('');
      if (hash_(data) !== meta.digest) throw new Error('Payroll integrity check failed. Restore a backup.');
      return json_({ok:true,revision:meta.revision,digest:meta.digest,data:data,commits:meta.commits});
    }
    if (request.action !== 'commit') return json_({ok:false,status:400,error:'Unsupported action.'});
    if (typeof request.transactionId !== 'string' || !/^[a-f0-9-]{36}$/.test(request.transactionId)) throw new Error('Invalid transaction ID.');
    if (meta.commits.indexOf(request.transactionId) >= 0) return json_({ok:true,revision:meta.revision});
    if (request.expectedRevision !== meta.revision) return json_({ok:false,status:409,error:'Spreadsheet changed. Retry using the latest revision.'});
    if (typeof request.data !== 'string' || request.data.length > 20000000 || hash_(request.data) !== request.digest) throw new Error('Invalid snapshot or checksum.');
    var names = ['Workers','Ledger','Audit','Imports'];
    names.forEach(function(name){
      var rows = request.tables && request.tables[name];
      if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0]) || rows[0].length > 20 || rows.some(function(row){return !Array.isArray(row) || row.length !== rows[0].length;})) throw new Error('Invalid review tables.');
    });
    // Write the inactive snapshot first. Commit by changing a single manifest cell.
    // The previous complete snapshot remains available if a write is interrupted.
    var slot = meta.slot === 'A' ? 'B' : 'A';
    var target = book.getSheetByName('_DTS_' + slot) || book.insertSheet('_DTS_' + slot);
    var parts = request.data.match(/.{1,30000}/g) || [''];
    ensureSize_(target,parts.length,1);
    target.clearContents();
    target.getRange(1,1,parts.length,1).setValues(parts.map(function(part){return [part];}));
    SpreadsheetApp.flush();
    var readBack = target.getRange(1,1,parts.length,1).getValues().map(function(row){return row[0];}).join('');
    if (hash_(readBack) !== request.digest) throw new Error('Snapshot verification failed. Previous revision remains active.');
    meta = {revision:meta.revision+1,slot:slot,chunks:parts.length,digest:request.digest,
      commits:meta.commits.concat([request.transactionId]).slice(-100),updatedAt:new Date().toISOString()};
    metaSheet = metaSheet || book.insertSheet('_DTS_Meta');
    metaSheet.getRange(1,1).setValue(JSON.stringify(meta));
    SpreadsheetApp.flush();
    // Review views are derived from the committed snapshot. They are not inputs.
    var warning = '';
    try {
      names.forEach(function(name){
        var view = book.getSheetByName(name) || book.insertSheet(name);
        var values = request.tables[name].map(function(row){return row.map(safeCell_);});
        ensureSize_(view,values.length,values[0].length);
        view.clearContents();view.getRange(1,1,values.length,values[0].length).setValues(values);
        view.setFrozenRows(1);
        view.getRange(1,1,1,values[0].length).setBackground('#155b49').setFontColor('#ffffff').setFontWeight('bold');
        view.getRange(1,1).setNote('Read-only review view. Edit payroll through the app. Updated: '+meta.updatedAt);
      });
      // Hide technical storage only after at least one visible review sheet exists.
      target.hideSheet();metaSheet.hideSheet();
      var previous = book.getSheetByName('_DTS_' + (slot === 'A' ? 'B' : 'A'));
      if (previous) previous.hideSheet();
      SpreadsheetApp.flush();
    } catch (viewError) { warning = 'Payroll saved. Review tabs could not refresh; use the app for current values.'; }
    return json_({ok:true,revision:meta.revision,warning:warning});
  } catch (error) { return json_({ok:false,status:503,error:error.message || 'Spreadsheet operation failed.'}); }
  finally { if (lock) lock.releaseLock(); }
}
function doGet() { return json_({ok:false,status:405,error:'Use the payroll application.'}); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function hash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}
function sameSecret_(a,b) {
  if (typeof b !== 'string') return false;
  var result = a.length ^ b.length;
  for (var i=0;i<Math.max(a.length,b.length);i++) result |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return result === 0;
}
function safeCell_(value) {
  if (value == null) return '';
  if (typeof value === 'string' && /^[=+@-]/.test(value)) return "'"+value;
  return value;
}
function ensureSize_(sheet,rows,columns) {
  if (sheet.getMaxRows()<rows) sheet.insertRowsAfter(sheet.getMaxRows(),rows-sheet.getMaxRows());
  if (sheet.getMaxColumns()<columns) sheet.insertColumnsAfter(sheet.getMaxColumns(),columns-sheet.getMaxColumns());
}
