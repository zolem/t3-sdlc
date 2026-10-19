// @ts-check
// Runs agent-written code against the factory API, Code Mode style.
//
// The agent submits an async arrow function as a string. It runs in a fresh
// node:vm context whose only globals are `factory` (host capabilities),
// `catalog` (search only) and a captured `console`. Arguments and results cross
// the boundary as JSON so no host objects leak into the context.
//
// node:vm is NOT a security boundary. Agents in this setup already have a shell
// on the same machine, so the sandbox exists for a compact, typed surface and
// predictable failure modes, not for isolation. Swap in QuickJS or workerd behind
// this interface if the factory ever runs code from untrusted callers.

import vm from 'node:vm';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * @param {unknown} value
 */
function toJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Build the `factory` object exposed inside the context.
 * @param {import('./registry.js').Registry} registry
 * @param {import('./registry.js').CallContext} ctx
 * @param {(entry: object) => void} onCall
 */
function buildFactory(registry, ctx, onCall) {
  /** @type {Record<string, Record<string, Function>>} */
  const api = {};
  for (const cap of registry.capabilities.values()) {
    api[cap.module] ??= {};
    api[cap.module][cap.name] = async (/** @type {unknown} */ args) => {
      const started = Date.now();
      try {
        const result = await cap.handler(toJson(args) ?? {}, ctx);
        onCall({ path: cap.path, ok: true, ms: Date.now() - started });
        return toJson(result);
      } catch (err) {
        onCall({ path: cap.path, ok: false, ms: Date.now() - started });
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${cap.path}: ${message}`);
      }
    };
  }
  return api;
}

/**
 * @param {string} code
 * @param {{ registry: import('./registry.js').Registry, ctx: import('./registry.js').CallContext, mode: 'search' | 'execute', timeoutMs?: number }} opts
 */
export async function runCode(code, { registry, ctx, mode, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  /** @type {string[]} */
  const logs = [];
  /** @type {object[]} */
  const calls = [];
  const fmt = (/** @type {unknown[]} */ args) => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const sandboxConsole = {
    log: (/** @type {unknown[]} */ ...a) => logs.push(fmt(a)),
    info: (/** @type {unknown[]} */ ...a) => logs.push(fmt(a)),
    warn: (/** @type {unknown[]} */ ...a) => logs.push(`warn: ${fmt(a)}`),
    error: (/** @type {unknown[]} */ ...a) => logs.push(`error: ${fmt(a)}`),
  };

  /** @type {Record<string, unknown>} */
  const globals = { console: sandboxConsole };
  if (mode === 'search') {
    globals.catalog = toJson(registry.catalog());
    globals.modules = toJson(registry.overview());
  } else {
    globals.factory = buildFactory(registry, ctx, entry => calls.push(entry));
  }

  const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } });
  let fn;
  try {
    fn = vm.runInContext(`(${code})`, context, { timeout: 5000, filename: `${mode}.js` });
  } catch (err) {
    return { ok: false, error: `Code did not compile: ${err instanceof Error ? err.message : String(err)}`, logs, calls };
  }
  if (typeof fn !== 'function') {
    return { ok: false, error: 'Code must be an async arrow function, e.g. async () => { return 1 }', logs, calls };
  }

  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    const result = await Promise.race([Promise.resolve(fn()), timeout]);
    return { ok: true, result: toJson(result), logs, calls };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), logs, calls };
  } finally {
    clearTimeout(timer);
  }
}
