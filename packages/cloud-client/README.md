# @dexto/cloud-client

A typed client for Dexto's public `/v1` API. The types are generated from the OpenAPI document Dexto serves at `https://api.dexto.ai/v1/openapi.json`, which is the public client contract: operation ids, methods and paths stay stable within `/v1`.

```ts
import { createCloudClient, unwrap } from '@dexto/cloud-client';

const client = createCloudClient({
    apiBaseUrl: 'https://api.dexto.ai',
    token: process.env.DEXTO_API_KEY!, // or an async function returning a person's fresh token
    cloudProject: null, // a person's token names the Cloud project it acts in
});

const secrets = await unwrap(await client.GET('/v1/secrets'));
```

`unwrap` returns the data, or throws a `CloudApiError` carrying Dexto's `code`, `message`, `requestId` and `retryable`.

Regenerate the types after `/v1` changes:

```bash
pnpm --filter @dexto/cloud-client sync
```
