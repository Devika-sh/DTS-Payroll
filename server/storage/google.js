import { randomUUID } from 'node:crypto';
import { emptyState, encodeState, decodeState, digest, reviewTables, storageError } from './state.js';

export class GoogleSpreadsheetStore {
  constructor(url, secret, request = fetch) {
    if(!url || !secret)throw storageError('Configure SHEETS_WEB_APP_URL and SHEETS_SECRET to connect Google Sheets.');
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url))throw storageError('SHEETS_WEB_APP_URL must be the deployed Google Apps Script /exec URL.');
    this.url=url;this.secret=secret;this.request=request;this.kind='google-sheets';
  }
  async call(payload) {
    let response;
    try {
      response=await this.request(this.url,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...payload,secret:this.secret}),redirect:'follow',signal:AbortSignal.timeout(50000)});
    } catch { throw storageError('Google Sheets could not be reached. Refresh the ledger before retrying a save.'); }
    let data;
    try { data=await response.json(); } catch { throw storageError('Google Sheets returned a sign-in page or invalid response. Check the Apps Script deployment and its access setting.'); }
    if(!response.ok || !data.ok)throw storageError(data.error || 'Google Sheets request failed.',data.status || 503);
    return data;
  }
  async read() {
    const response=await this.call({action:'read'});
    if(!response.data) {
      if(response.revision !== 0)throw storageError('Google Sheets state is missing. Restore the previous snapshot.');
      return {revision:0,state:emptyState(),commits:response.commits || []};
    }
    if(digest(response.data)!==response.digest)throw storageError('Google Sheets integrity check failed. Restore a backup.');
    return {revision:response.revision,state:decodeState(response.data),commits:response.commits || []};
  }
  async mutate(fn) {
    const transactionId=randomUUID();
    for(let attempt=0;attempt<4;attempt++) {
      const {state,revision}=await this.read();
      const result=await fn(state);
      const data=encodeState(state);
      try {
        await this.call({action:'commit',expectedRevision:revision,transactionId,data,digest:digest(data),tables:reviewTables(state)});
        return result;
      } catch(e) {
        if(e.status===409)continue;
        // A lost response must not cause a second payment or import.
        try { if((await this.read()).commits.includes(transactionId))return result; } catch {}
        throw e;
      }
    }
    throw storageError('Payroll changed repeatedly while saving. Refresh and try again.',409);
  }
}
