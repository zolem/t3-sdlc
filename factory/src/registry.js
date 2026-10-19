// @ts-check
// Capability registry. Each module contributes typed functions that agents
// discover through `search` and call from `execute` as `factory.<module>.<fn>()`.

/**
 * @typedef {object} Capability
 * @property {string} path         e.g. "run.read"
 * @property {string} module       e.g. "run"
 * @property {string} name         e.g. "read"
 * @property {string} signature    TypeScript-ish call shape shown to agents
 * @property {string} description  one or two sentences
 * @property {string[]} [tags]
 * @property {(args: any, ctx: CallContext) => any} handler
 */

/**
 * @typedef {object} CallContext
 * @property {string} cwd  working directory of the calling harness process
 * @property {string} home factory state root (~/.t3-sdlc)
 * @property {Record<string, string>} [signatures] capability path → call signature, for briefs
 */

/**
 * @typedef {object} ModuleDef
 * @property {string} name
 * @property {string} description
 * @property {Record<string, Omit<Capability, 'path' | 'module' | 'name'>>} functions
 */

export class Registry {
  constructor() {
    /** @type {Map<string, Capability>} */
    this.capabilities = new Map();
    /** @type {Map<string, string>} */
    this.modules = new Map();
  }

  /** @param {ModuleDef} def */
  add(def) {
    this.modules.set(def.name, def.description);
    for (const [name, fn] of Object.entries(def.functions)) {
      const path = `${def.name}.${name}`;
      this.capabilities.set(path, { ...fn, path, module: def.name, name });
    }
    return this;
  }

  /** Public catalog: everything except handlers. */
  catalog() {
    return [...this.capabilities.values()].map(({ handler, ...rest }) => rest);
  }

  /**
   * Keyword search used when an agent passes `query` instead of `code`.
   * @param {string} query
   * @param {number} [limit]
   */
  search(query, limit = 12) {
    const terms = query.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
    if (terms.length === 0) return this.overview();
    const scored = this.catalog().map(c => {
      const hay = `${c.path} ${c.description} ${(c.tags || []).join(' ')}`.toLowerCase();
      const score = terms.reduce((s, t) => s + (c.path.toLowerCase().includes(t) ? 3 : 0) + (hay.includes(t) ? 1 : 0), 0);
      return { c, score };
    });
    return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.c);
  }

  overview() {
    return [...this.modules.entries()].map(([name, description]) => ({
      module: name,
      description,
      functions: this.catalog().filter(c => c.module === name).map(c => c.name),
    }));
  }
}
