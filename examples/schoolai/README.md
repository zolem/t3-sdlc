# Example: org-specific overlays

The factory's role briefs in `roles/` are generic. Org and stack knowledge belongs in the repos it applies to.

Copy `.orchestrate/roles/*.md` from this folder into a SchoolAI repo (for example `web-app/.orchestrate/roles/`) and commit them. These files are appended to the generic briefs whenever that repo takes part in a run:
- the architect gets the stack rules
- the context curator gets the surface map and the internal Notion docs

Use the same pattern for any org: put a `.orchestrate/roles/<role>.md` in each repo, and add a `.orchestrate/policy.json` there if that repo needs different models.
