// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'));

/** Best-effort guess at which harness spawned this server, from its environment. */
function detectHarness() {
  const env = process.env;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude';
  if (env.CODEX_HOME || env.CODEX_SANDBOX || env.CODEX_THREAD_ID) return 'codex';
  if (env.OPENCODE || env.OPENCODE_BIN_PATH) return 'opencode';
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) return 'cursor';
  return 'unknown';
}

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'meta',
  description: 'Factory health and caller identity.',
  functions: {
    whoami: {
      signature: 'factory.meta.whoami(): Promise<{ version: string, cwd: string, home: string, harness: string, pid: number }>',
      description: 'Returns the factory version, the calling process working directory, the state root, and a guess at the harness.',
      tags: ['health', 'ping', 'identity'],
      handler: (_args, ctx) => ({ version: PKG.version, cwd: ctx.cwd, home: ctx.home, harness: detectHarness(), pid: process.pid }),
    },
  },
};
