---
'@dexto/client-sdk': patch
'dexto-webui': patch
---

Add validation schemas to client SDK and fix baseURL naming consistency 
- Add comprehensive Zod validation schemas for all API endpoints 
- Export validation module from client SDK index 
- Fix baseURL vs baseUrl naming mismatch between schema and types 
- Add client-side validation for better error handling
