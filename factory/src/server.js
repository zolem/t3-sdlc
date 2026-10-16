// @ts-check
// MCP server exposing the factory through two tools, after Cloudflare's Code Mode:
//   search  — find capabilities without loading the whole catalog into context
//   execute — run an async arrow function that calls `factory.<module>.<fn>()`

import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Registry } from './registry.js';
import { runCode } from './sandbox.js';
import { loadModules } from './modules/index.js';

const INSTRUCTIONS = `The t3-sdlc factory. Everything an SDLC agent needs lives behind two tools.

1. search: discover capabilities. Pass {query: "write a run file"} for keyword search, or
   {code: "async () => catalog.filter(c => c.module === 'run')"} to filter the typed catalog yourself.
   With no arguments it lists modules.
2. execute: pass {code: "async () => { ... }"}. Inside, call capabilities as
   await factory.<module>.<fn>({ ...args }). Return only what you need; chain several calls in one execute.

If your task prompt names a run id and role, start with:
  execute: async () => factory.roles.brief({ runId: "<run>", role: "<role>" })
and follow the brief it returns.`;

export function createServer() {
  const registry = new Registry();
  for (const mod of loadModules()) registry.add(mod);

  const ctx = {
    cwd: process.cwd(),
    home: process.env.ORCHESTRATE_HOME || path.join(os.homedir(), '.orchestrate'),
    signatures: Object.fromEntries(registry.catalog().map(c => [c.path, c.signature])),
  };

  const server = new McpServer({ name: 'factory', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'search',
    {
      description:
        'Find factory capabilities. {query} does keyword search; {code} runs an async arrow fn over `catalog` (array of {path, signature, description, module, tags}) and `modules`. No args lists modules.',
      inputSchema: {
        query: z.string().optional().describe('Short task phrase, e.g. "read role brief"'),
        code: z.string().optional().describe('async () => catalog.filter(c => c.module === "run")'),
      },
    },
    async ({ query, code }) => {
      if (code) {
        const out = await runCode(code, { registry, ctx, mode: 'search', timeoutMs: 10_000 });
        return reply(out);
      }
      const result = query ? registry.search(query) : registry.overview();
      return reply({ ok: true, result });
    },
  );

  server.registerTool(
    'execute',
    {
      description:
        'Run an async arrow function against the factory API: async () => { const b = await factory.roles.brief({runId, role}); return b }. Use search first to find call shapes. Returns {ok, result, logs, calls} or {ok:false, error}.',
      inputSchema: {
        code: z.string().describe('async () => { ... } calling await factory.<module>.<fn>(args)'),
        cwd: z.string().optional().describe('Override the working directory capabilities resolve paths against (defaults to the harness cwd).'),
      },
    },
    async ({ code, cwd }) => {
      const out = await runCode(code, { registry, ctx: { ...ctx, cwd: cwd ? path.resolve(cwd) : ctx.cwd }, mode: 'execute' });
      return reply(out);
    },
  );

  return server;
}

/** @param {{ ok: boolean, [k: string]: unknown }} out */
function reply(out) {
  // Text for chat-style clients, structuredContent for code-mode clients (OpenCode)
  // that read tool results as values.
  return {
    content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify(out, null, 2) }],
    structuredContent: out,
    isError: !out.ok,
  };
}

export async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
