---
'@dexto/agent-management': patch
---

`dexto login --device` keeps polling through a dropped connection or a server error, including an HTML gateway error page, instead of failing while the code is still valid.
