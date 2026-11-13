---
'dexto': patch
---

`dexto cloud sites deploy` packs a plain static folder itself: a project with no `.dexto/pack.mjs` and no `pack` script deploys the pages its `dexto.json` names, instead of failing in `pnpm run pack`.
