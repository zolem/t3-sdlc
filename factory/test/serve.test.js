// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runFilesUrl } from '../src/lib/serve.js';
import { runFile } from '../src/lib/store.js';

test('a run\'s pages are served on localhost, reused, and confined to the run folder', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-'));
  const page = runFile(home, 'r1', 'explainers/plan.html');
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, '<html><body>plan</body></html>');
  fs.writeFileSync(path.join(home, 'secret.txt'), 'no');
  const base = runFilesUrl(home, 'r1');
  try {
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${base}/explainers/plan.html`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.equal(await res.text(), '<html><body>plan</body></html>');
    assert.equal((await fetch(`${base}/../../secret.txt`)).status, 404);
    assert.equal(runFilesUrl(home, 'r1'), base, 'the same server is reused');
  } finally {
    const { pid } = JSON.parse(fs.readFileSync(runFile(home, 'r1', 'apps/serve.json'), 'utf8'));
    process.kill(pid);
  }
});
