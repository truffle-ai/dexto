---
'dexto': patch
---

`--project` and `DEXTO_CLOUD_PROJECT` are checked against your Cloud projects before a command reaches Dexto. A value that names none of them, such as a Dexto Project id, fails with exit 5, lists your Cloud projects and points Dexto Projects at `--in-project`, instead of being ignored. `whoami` checks it too.
