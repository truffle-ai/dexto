---
'@dexto/core': patch
'@dexto/tools-builtins': patch
---

Close the remaining gaps in how model-driven requests are kept off private addresses. The private-address check now also blocks NAT64 (64:ff9b::/96), site-local (fec0::/10) and multicast (ff00::/8) IPv6 addresses. `http_request` refuses a 307 or 308 redirect that would send its request body to another origin. Image and file URLs that the AI SDK downloads for a model are now resolved first and refused when any answer is a private address, and the connection uses the address that was checked.
