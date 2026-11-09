---
'@dexto/core': patch
'@dexto/tools-builtins': patch
---

Close the remaining gaps in how model-driven requests are kept off private addresses. The private-address check now also blocks site-local (fec0::/10) and multicast (ff00::/8) IPv6 addresses and NAT64 (64:ff9b::/96) addresses that translate to a private IPv4 address. `http_request` refuses a redirect to another origin that would still send its request body, whatever the status or method. Image and file URLs that the AI SDK downloads for a model are now resolved first and refused when any answer is a private address, and the connection uses the address that was checked.
