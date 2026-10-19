# Example: org-specific overlays

The factory's role briefs in `roles/` are generic. Org and stack knowledge belongs in the repos it applies to. "Acme" is a made-up company; replace its rules with yours.

Copy `.orchestrate/` from this folder into one of your repos and commit it. The files under `roles/` are appended to the generic briefs whenever that repo takes part in a run:
- `architect.md` gives the architect your stack rules
- `context-curator.md` tells the context curator where your docs live
- `policy.json` (optional) changes which models run each role for this repo

Start a file with `mode: replace` in its frontmatter to replace the generic brief instead of appending to it.
