#!/usr/bin/env node
// t3-sdlc: the T3 SDLC factory CLI. Run with no arguments for the agent guide.
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`t3-sdlc needs Node.js >= 22 (found ${process.versions.node}).`);
  process.exit(127);
}
const { main } = await import('../src/cli.js');
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  console.error(`t3-sdlc: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}
