// @ts-check
import { APP_ROOT, VERSION } from '../lib/paths.js';

/** Best-effort guess at which harness is calling, from the environment it passes down. */
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
      signature: 'factory.meta.whoami(): Promise<{ version: string, cwd: string, home: string, app: string, harness: string }>',
      description: 'Returns the factory version, the working directory calls resolve against, the state root, the app root, and a guess at the harness.',
      tags: ['health', 'ping', 'identity'],
      handler: (_args, ctx) => ({ version: VERSION, cwd: ctx.cwd, home: ctx.home, app: APP_ROOT, harness: detectHarness() }),
    },
  },
};
