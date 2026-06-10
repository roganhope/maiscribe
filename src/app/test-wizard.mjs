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
await new Promise(r => setTimeout(r, 1500));

// Step 1: Folder - should see "Project Folder" heading
await win.screenshot({ path: '/tmp/wizard-01-folder.png' });
console.log('Step 1: Folder page');

// Fill in the folder path
const folderInput = win.locator('input[placeholder="/path/to/audio-transcription"]');
await folderInput.fill('/Users/hope/Documents/code/audio-transcription');
await new Promise(r => setTimeout(r, 500));

// Click Next
await win.locator('button:has-text("Next")').click();
await new Promise(r => setTimeout(r, 500));
await win.screenshot({ path: '/tmp/wizard-02-modal.png' });
console.log('Step 2: Modal page');

// Fill in Modal tokens
const modalInputs = win.locator('input[type="password"]');
await modalInputs.nth(0).fill('ak-QKdimkyAYx5Qu8koWBRJ05');
await modalInputs.nth(1).fill('as-mK27ZFR5tNwolPiVHdmmSs');
await new Promise(r => setTimeout(r, 300));

// Test connection
await win.locator('button:has-text("Test Connection")').click();
console.log('Testing Modal connection...');
await new Promise(r => setTimeout(r, 5000));
await win.screenshot({ path: '/tmp/wizard-03-modal-tested.png' });

// Try to click Next (if test passed) or skip
const nextBtn = win.locator('button:has-text("Next")');
const skipBtn = win.locator('text=Set up later');
if (await nextBtn.isEnabled()) {
  await nextBtn.click();
  console.log('Modal test passed, clicking Next');
} else {
  await skipBtn.click();
  console.log('Modal test did not pass, skipping');
}
await new Promise(r => setTimeout(r, 500));
await win.screenshot({ path: '/tmp/wizard-04-huggingface.png' });
console.log('Step 3: Hugging Face page');

// Skip HF for now (we don't have a token in the env)
await win.locator('text=Set up later').click();
await new Promise(r => setTimeout(r, 500));
await win.screenshot({ path: '/tmp/wizard-05-claude.png' });
console.log('Step 4: Claude page');

// Fill Claude key
const claudeInput = win.locator('input[type="password"]');
await claudeInput.fill('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');
await new Promise(r => setTimeout(r, 300));

// Test Claude
await win.locator('button:has-text("Test Connection")').click();
console.log('Testing Claude connection...');
await new Promise(r => setTimeout(r, 5000));
await win.screenshot({ path: '/tmp/wizard-06-claude-tested.png' });

// Move to options
const nextBtn2 = win.locator('button:has-text("Next")');
const skipBtn2 = win.locator('text=Set up later');
if (await nextBtn2.isEnabled()) {
  await nextBtn2.click();
  console.log('Claude test passed, clicking Next');
} else {
  await skipBtn2.click();
  console.log('Claude test did not pass, skipping');
}
await new Promise(r => setTimeout(r, 500));
await win.screenshot({ path: '/tmp/wizard-07-options.png' });
console.log('Step 5: Options page');

// Click Finish
await win.locator('button:has-text("Finish")').click();
await new Promise(r => setTimeout(r, 1000));
await win.screenshot({ path: '/tmp/wizard-08-done.png' });
console.log('Step 6: Done!');

await app.close();
console.log('\nAll screenshots saved to /tmp/wizard-*.png');
