import { app } from './app.js';
import { getStore } from './storage/index.js';
await getStore().read();
const port = Number(process.env.PORT || 3001);
app.listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`Payroll: http://127.0.0.1:${port}`));
