/** Verifies redaction: every credential shape, truncated keys, secret files and counts. */
import { performance } from 'node:perf_hooks';
import { assert, describe, expect, it } from 'vitest';

import {
    countMarkers,
    excludeSecretFile,
    redactSecrets,
    excludeSecretFileInCommand,
    isSecretPath,
} from './redaction.js';

// Fixtures are assembled at runtime so no literal credential sits in the repository.
const AWS = `AKIA${'ABCDEFGHIJKLMNOP'}`;
const GITHUB = `ghp_${'a'.repeat(36)}`;
const GOOGLE = `AIza${'b'.repeat(35)}`;
const JWT = `eyJ${'h'.repeat(10)}.eyJ${'p'.repeat(10)}.${'s'.repeat(10)}`;
const OPENAI = `sk-${'c'.repeat(24)}`;
const SLACK = `xoxb-${'1'.repeat(12)}`;
const STRIPE = `sk_live_${'d'.repeat(24)}`;
const NPM = `npm_${'e'.repeat(36)}`;
const GITLAB = `glpat-${'f'.repeat(20)}`;
const HUGGING_FACE = `hf_${'g'.repeat(34)}`;
const DIGITALOCEAN = `dop_v1_${'a1'.repeat(32)}`;
const PRIVATE_KEY = [
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'b3BlbnNzaC1rZXktdjEAAAAA',
    '-----END OPENSSH PRIVATE KEY-----',
].join('\n');

describe('redactSecrets', () => {
    it.each([
        ['private_key', `key:\n${PRIVATE_KEY}\ndone`],
        ['secret_key', `export OPENAI=${OPENAI}`],
        ['github_token', `remote https://${GITHUB}@github.com`],
        ['aws_access_key', `id ${AWS} here`],
        ['slack_token', `slack ${SLACK}`],
        ['google_api_key', `google ${GOOGLE}`],
        ['jwt', `cookie ${JWT}`],
        ['bearer_token', `Authorization: Bearer ${'t'.repeat(20)}`],
        ['secret_key', `stripe ${STRIPE}`],
        ['npm_token', `//registry.npmjs.org/:_authToken=${NPM}`],
        ['gitlab_token', `gitlab ${GITLAB}`],
        ['huggingface_token', `hf ${HUGGING_FACE}`],
        ['digitalocean_token', `do ${DIGITALOCEAN}`],
        ['url_password', 'postgres://app:hunter2@db.internal:5432/app'],
        ['basic_auth', 'authorization: basic dXNlcjpwYXNz'],
    ])('replaces a %s with its marker', (kind, text) => {
        const result = redactSecrets(text);
        expect(result).toContain(`[redacted:${kind}]`);
        expect(result).not.toMatch(
            /AKIA[A-Z]|ghp_a|AIzab|eyJhh|sk-cc|xoxb-1|b3BlbnNz|tttttttt|dddd|eeee|ffff|gggg|a1a1|hunter2|dXNlcjpwYXNz/u
        );
    });

    // DEXTO-2043: Dexto Cloud's own credentials, and common shapes the first patterns missed.
    const B64 = 'Ab9_-'.repeat(9);
    it.each([
        ['dexto_token', `DEXTO key dxt_${B64}`],
        ['dexto_token', `cli token dexto_mcp_at_${B64}`],
        ['dexto_token', `refresh dexto_mcp_rt_${B64}`],
        ['dexto_token', `native refresh dxt_nrt_${B64}`],
        ['dexto_token', `signed dexto_native_access.${B64}.${B64}`],
        ['slack_token', `app token xapp-1-A0${'1'.repeat(12)}-${'a'.repeat(20)}`],
        [
            'slack_webhook',
            `https://hooks.slack.com/services/T0${'1'.repeat(8)}/B0${'2'.repeat(8)}/${'h'.repeat(24)}`,
        ],
        ['google_oauth', `access ya29.${'g'.repeat(40)}`],
        ['google_oauth', `client secret GOCSPX-${'g'.repeat(28)}`],
        ['sendgrid_key', `SG.${'s'.repeat(22)}.${'s'.repeat(43)}`],
        ['secret_key', `webhook whsec_${'w'.repeat(32)}`],
        ['api_key', `groq gsk_${'q'.repeat(40)}`],
        ['api_key', `xai xai-${'x'.repeat(40)}`],
        ['api_key', `replicate r8_${'r'.repeat(30)}`],
        ['api_key', `e2b e2b_${'e'.repeat(40)}`],
        ['api_key', `supabase sbp_${'5'.repeat(40)}`],
        ['api_key', `supabase sb_secret_${'5'.repeat(32)}`],
        ['api_key', `linear lin_api_${'l'.repeat(40)}`],
        ['api_key', `shopify shpat_${'f'.repeat(32)}`],
        ['api_key', `sentry sntrys_${'y'.repeat(40)}`],
    ])('replaces a %s with its marker (%s)', (kind, text) => {
        const result = redactSecrets(text);
        expect(result).toContain(`[redacted:${kind}]`);
        expect(result).not.toMatch(
            /Ab9_-Ab9|1111111111|hhhhhhhh|gggggggg|ssssssss|wwwwwwww|qqqqqqqq|xxxxxxxx|rrrrrrrr|eeeeeeee|55555555|llllllll|ffffffff|yyyyyyyy/u
        );
        expect(redactSecrets(result)).toBe(result);
    });

    it.each([
        ['STRIPE_KEY=abcdefgh12345678', 'STRIPE_KEY=[redacted:assignment]'],
        ['ENCRYPTION_KEY="abcdefgh12345678"', 'ENCRYPTION_KEY="[redacted:assignment]"'],
        ['DB_PASS=hunter2', 'DB_PASS=[redacted:assignment]'],
        [
            'DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=abcdefgh12345678==;EndpointSuffix=core.windows.net',
            'DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=[redacted:assignment];EndpointSuffix=core.windows.net',
        ],
        ['{"STRIPE_KEY": "abcdefgh12345678"}', '{"STRIPE_KEY": "[redacted:assignment]"}'],
        ['PG_PASS: hunter22', 'PG_PASS: [redacted:assignment]'],
    ])('redacts the value in the env-style %s', (text, expected) => {
        expect(redactSecrets(text)).toBe(expected);
        expect(redactSecrets(expected)).toBe(expected);
    });

    // DEXTO-2043: a tool part's input or output arrives as JSON, where a line break is `\n`.
    const DEXTO = `dxt_${'k'.repeat(40)}`;
    it.each([
        ['{"STRIPE_KEY": "abcdefgh12345678"}', '{"STRIPE_KEY": "[redacted:assignment]"}'],
        ['api_key: "abcdefgh12345678"', 'api_key: "[redacted:assignment]"'],
        ['{"password": "hunter22"}', '{"password": "[redacted:assignment]"}'],
        ['PASSWORD="hunter22"', 'PASSWORD="[redacted:assignment]"'],
    ])('redacts the assignment %s inside JSON-escaped text', (text, expected) => {
        // A tool part's input is redacted as raw JSON, where its quotes arrive as `\"`.
        const json = JSON.stringify({ input: text });

        const result = redactSecrets(json);

        expect(JSON.parse(result)).toEqual({ input: expected });
        expect(redactSecrets(result)).toBe(result);
    });

    // DEXTO-2043: the token pass runs first, so a value that starts with a token must still be
    // redacted whole, tail included.
    const A = 'A'.repeat(40);
    it.each([
        [`password=xai-${A}!hunter2tail`, 'password=[redacted:assignment]'],
        [`password=sk-${A}!hunter2tail`, 'password=[redacted:assignment]'],
        [`DB_PASSWORD=whsec_${A}+realpass`, 'DB_PASSWORD=[redacted:assignment]'],
        [`client_secret: GOCSPX-${A}~moresecret`, 'client_secret: [redacted:assignment]'],
        [`api_token=dxt_${A}.sig.extra`, 'api_token=[redacted:assignment]'],
        [`password="xai-${A}!hunter2tail"`, 'password="[redacted:assignment]"'],
        [`password="sk-${A}!hunter2tail"`, 'password="[redacted:assignment]"'],
        [`password="r8_${A}%tail"`, 'password="[redacted:assignment]"'],
        [`password=sk-${A}`, 'password=[redacted:secret_key]'],
    ])('redacts the whole assignment value %s that starts with a token', (text, expected) => {
        expect(redactSecrets(text)).toBe(expected);
        expect(redactSecrets(expected)).toBe(expected);

        const json = JSON.stringify({ c: text });
        const result = redactSecrets(json);
        expect(result).not.toMatch(/tail|realpass|moresecret|sig\.extra|AAAA/u);
        expect(JSON.parse(result)).toEqual({ c: expected });
        expect(redactSecrets(result)).toBe(result);
    });

    it.each(['\n', '\t', '\r', '\f', '\b', '\u0001'])(
        'redacts tokens after a JSON-escaped %j',
        (escape) => {
            const json = JSON.stringify({
                content: `my key:${escape}${DEXTO}${escape}${GITHUB}${escape}${OPENAI}${escape}STRIPE_KEY=abcdefgh12345678`,
            });

            const result = redactSecrets(json);

            expect(result).not.toMatch(/dxt_k|ghp_a|sk-cc|abcdefgh/u);
            expect(JSON.parse(result)).toEqual({
                content: `my key:${escape}[redacted:dexto_token]${escape}[redacted:github_token]${escape}[redacted:secret_key]${escape}STRIPE_KEY=[redacted:assignment]`,
            });
        }
    );

    it('leaves Dexto tool names and ordinary keys in code alone', () => {
        for (const text of [
            'dexto_skill_bundle_import and dexto_managed_sandbox_artifact_transfer_v1',
            'PRIMARY_KEY=id',
            'sort_key = "created_at_desc"',
            'const cacheKey = buildCacheKey(user);',
        ])
            expect(redactSecrets(text)).toBe(text);
    });

    it.each([
        ['secret_key: abcdefgh12345', 'secret_key: [redacted:assignment]'],
        ['AWS_SECRET_ACCESS_KEY=abcdefgh12345678', 'AWS_SECRET_ACCESS_KEY=[redacted:assignment]'],
        ['accessToken: abcdefgh12345', 'accessToken: [redacted:assignment]'],
        ['clientSecret = "abcdefgh12345"', 'clientSecret = "[redacted:assignment]"'],
        ['PASSWORD=short', 'PASSWORD=[redacted:assignment]'],
        ['password = "a b c d"', 'password = "[redacted:assignment]"'],
        ['{"db_password": "x y"}', '{"db_password": "[redacted:assignment]"}'],
    ])('redacts the value in %s', (text, expected) => {
        expect(redactSecrets(text)).toBe(expected);
        expect(redactSecrets(expected)).toBe(expected);
    });

    // A tool part's input is raw JSON, and a JSON string can itself hold JSON, so a
    // quote arrives as `"`, `\"`, `\\\"` and so on. Each depth is the one before, JSON-encoded.
    function escaped(text: string, depth: number): string {
        let result = text;
        for (let level = 0; level < depth; level += 1) result = JSON.stringify({ input: result });
        return result;
    }
    function unescaped(json: string, depth: number): unknown {
        let result: unknown = json;
        for (let level = 0; level < depth; level += 1) {
            assert(typeof result === 'string');
            const parsed: unknown = JSON.parse(result);
            assert(typeof parsed === 'object' && parsed !== null && 'input' in parsed);
            result = parsed.input;
        }
        return result;
    }
    describe.each([0, 1, 2, 3])('at JSON escape depth %i', (depth) => {
        it.each([
            ['password="hunter22"', 'password="[redacted:assignment]"'],
            ['{"password": "hunter22"}', '{"password": "[redacted:assignment]"}'],
            ['{"api_key":"abcdefgh12345678"}', '{"api_key":"[redacted:assignment]"}'],
            [
                '{"input":"{\\"password\\":\\"hunter22\\"}"}',
                '{"input":"{\\"password\\":\\"[redacted:assignment]\\"}"}',
            ],
            ['export PASSWORD="hun\\"ter22" next', 'export PASSWORD="[redacted:assignment]" next'],
            ['TOKEN="abc\\"defghijk"', 'TOKEN="[redacted:assignment]"'],
            ['password="ends\\\\\\\\" next', 'password="[redacted:assignment]" next'],
            ['password=hunter22 next', 'password=[redacted:assignment] next'],
            ['{"cmd":"x password=hunter22"}', '{"cmd":"x password=[redacted:assignment]"}'],
        ])('redacts the value in %s, keeping the JSON valid', (text, expected) => {
            const result = redactSecrets(escaped(text, depth));

            expect(result).not.toMatch(/hunter|ter22|abcdefgh|defghijk|ends/u);
            expect(unescaped(result, depth)).toBe(expected);
            expect(redactSecrets(result)).toBe(result);
        });

        it('never crosses the end of the string holding the value', () => {
            // The value's quote opens, but the string holding it ends before the quote closes.
            const text = '{"a":"password=\\"x","b":"keep me"}';

            const result = unescaped(redactSecrets(escaped(text, depth)), depth);

            assert(typeof result === 'string');
            expect(JSON.parse(result)).toMatchObject({ b: 'keep me' });
        });
    });

    it('leaves ordinary settings and prose alone', () => {
        for (const text of ['max_tokens: 4096', 'the password is wrong', 'secret: true'])
            expect(redactSecrets(text)).toBe(text);
    });

    it('stays fast on a long adversarial identifier', () => {
        const text = `${'a_'.repeat(32_000)}token`;
        const started = performance.now();
        redactSecrets(text);
        expect(performance.now() - started).toBeLessThan(500);
    });

    it('stays fast on a long run of backslashes after a quote', () => {
        const text = `password="${'\\'.repeat(64_000)}x token: \\"${'\\'.repeat(64_000)}`;
        const started = performance.now();
        redactSecrets(text);
        expect(performance.now() - started).toBeLessThan(500);
    });

    it("keeps an assignment's name and drops its value", () => {
        expect(redactSecrets('DB_PASSWORD="hunter2hunter2"')).toBe(
            'DB_PASSWORD="[redacted:assignment]"'
        );
        expect(redactSecrets('api_key: 1234567890abcdef')).toBe('api_key: [redacted:assignment]');
    });

    it('redacts a plain-text quoted value that ends in a backslash', () => {
        expect(redactSecrets('password="SECRETVAL\\"')).toBe('password="[redacted:assignment]"');
        expect(redactSecrets('set PASSWORD="C:\\pw\\"')).toBe(
            'set PASSWORD="[redacted:assignment]"'
        );
        expect(redactSecrets('x token: "SECRETVAL\\" more')).toBe(
            'x token: "[redacted:assignment]" more'
        );
        expect(redactSecrets('cmd clientSecret: "SECRETVAL\\"\nnext')).toBe(
            'cmd clientSecret: "[redacted:assignment]"\nnext'
        );
    });

    it('redacts a private key block cut in half by truncation', () => {
        const cut = `${PRIVATE_KEY.slice(0, 50)}\n… [120 more characters left out]`;
        expect(redactSecrets(`before\n${cut}`)).toBe('before\n[redacted:private_key]');
    });

    it('redacts a JWT whose signature was cut off', () => {
        const cut = JWT.slice(0, JWT.lastIndexOf('.'));
        expect(redactSecrets(`token ${cut}`)).toBe('token [redacted:jwt]');
    });

    it('leaves markers and ordinary text alone, so redacting twice changes nothing', () => {
        const once = redactSecrets(`ordinary text, password = ${'x'.repeat(12)} and ${OPENAI}`);
        expect(redactSecrets(once)).toBe(once);
        expect(redactSecrets('fix the token refresh bug')).toBe('fix the token refresh bug');
    });
});

describe('excludeSecretFile', () => {
    it.each([
        '.env',
        'app/.env.local',
        'certs/server.pem',
        'tls.key',
        '/home/me/.ssh/config',
        '/home/me/.ssh/id_ed25519.pub',
        'id_rsa',
        '~/.aws/config',
        '.npmrc',
        '.netrc',
        '.pgpass',
        'credentials.json',
        'C:\\Users\\me\\.aws\\credentials',
        'app/.ENV',
        '.dev.vars',
        '~/.git-credentials',
        'infra/terraform.tfstate',
        '~/.kube/config',
        'service-account-prod.json',
        'deploy/secrets.yaml',
    ])('excludes the contents of %s', (path) => {
        const name = path.split(/[\\/]/u).at(-1);
        expect(excludeSecretFile(path)).toBe(`[excluded: secret file ${name}]`);
    });

    it.each([`~/.aws/sk-${'c'.repeat(24)}`, '/home/me/.ssh/a]b'])(
        'leaves the name out when %s could leak a secret or end the marker',
        (path) => {
            expect(excludeSecretFile(path)).toBe('[excluded: secret file]');
        }
    );

    it.each(['src/env.ts', 'README.md', 'keys.ts', 'docs/my-credentials.md', 'monkey'])(
        'keeps %s',
        (path) => {
            expect(excludeSecretFile(path)).toBeNull();
        }
    );
});

describe('excludeSecretFileInCommand', () => {
    it('finds the secret-shaped file a command names', () => {
        expect(excludeSecretFileInCommand('cat .env')).toBe('[excluded: secret file .env]');
        expect(excludeSecretFileInCommand("grep KEY 'app/.env.local' | head")).toBe(
            '[excluded: secret file .env.local]'
        );
        expect(excludeSecretFileInCommand('cat ~/.ssh/config')).toBe(
            '[excluded: secret file config]'
        );
        expect(excludeSecretFileInCommand('pnpm test src/env.ts')).toBeNull();
    });

    it('finds it in input sent as escaped JSON', () => {
        expect(excludeSecretFileInCommand(JSON.stringify({ command: 'bash -c "cat .env"' }))).toBe(
            '[excluded: secret file .env]'
        );
        expect(excludeSecretFileInCommand(JSON.stringify({ command: 'cat .env\ncat x' }))).toBe(
            '[excluded: secret file .env]'
        );
        expect(excludeSecretFileInCommand('type C:\\Users\\me\\.ssh\\config')).toBe(
            '[excluded: secret file config]'
        );
    });
});

describe('countMarkers', () => {
    it('counts redaction and exclusion markers by kind', () => {
        expect(
            countMarkers(
                '[redacted:jwt] and [redacted:jwt], [redacted:assignment], [excluded: secret file .env] [excluded: secret file]'
            )
        ).toEqual({ assignment: 1, jwt: 2, secret_file: 2 });
    });
});

describe('isSecretPath, stricter on the client than on the server', () => {
    it('counts a secret folder itself, .envrc, and a glob that could name a secret file', () => {
        for (const path of [
            '~/.kube',
            '.ssh',
            '/home/x/.aws',
            '.envrc',
            '.env*',
            '.e?v',
            '*.key',
            'id_*',
        ])
            expect(isSecretPath(path), path).toBe(true);
    });

    it('leaves wildcards alone and names that only look alike', () => {
        for (const path of ['*', '.*', '*.ts', 'src/**', '.environment', 'kube', '.sshrc'])
            expect(isSecretPath(path), path).toBe(false);
    });

    it('excludes a command that works in a secret folder', () => {
        expect(excludeSecretFileInCommand('cd ~/.kube && cat config')).toBe(
            '[excluded: secret file .kube]'
        );
        expect(excludeSecretFileInCommand('cat .env*')).toMatch(/^\[excluded: secret file/u);
    });
});
