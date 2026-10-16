#!/usr/bin/env node
import { main } from '../src/server.js';

main().catch(err => {
  console.error(err);
  process.exit(1);
});
