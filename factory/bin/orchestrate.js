#!/usr/bin/env node
// `orchestrate check <name>` inside .orchestrate/factory.json commands. Same CLI as t3-sdlc.
const { main } = await import('../src/cli.js');
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  console.error(`t3-sdlc: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}
