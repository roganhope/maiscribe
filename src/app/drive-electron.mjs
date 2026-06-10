import { _electron as electron } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = await electron.launch({
  args: [join(__dirname, 'out/main/index.js')],
  cwd: __dirname,
});

const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await new Promise(r => setTimeout(r, 2000));
await win.screenshot({ path: '/tmp/electron-tabs.png' });
await app.close();
