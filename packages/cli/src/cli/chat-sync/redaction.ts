// Redacts a chat before it syncs to Dexto Cloud. A copy of the server's own rules
// (truffle-ai/dexto-cloudflare `apps/cloud/src/chat-sync/redaction.ts`), which redacts every
// message again: the same markers mean a resent message matches the one stored for it.

// Where a token may begin: not inside a word, but right after a JSON escape such as `\n` or
// `\u0001`, whose letters would otherwise hide the boundary in a tool part's JSON input or output.
const START = String.raw`(?:(?<=\\[bfnrt]|\\u[0-9A-Fa-f]{4})|(?<!\w))`;

/** The pattern, matched only where a token may begin. */
function atStart(pattern: RegExp): RegExp {
    return new RegExp(`${START}(?:${pattern.source})`, pattern.flags);
}

/** Credential shapes, most specific first; each match becomes `[redacted:<kind>]`. */
const SECRET_PATTERNS: readonly (readonly [kind: string, pattern: RegExp])[] = [
    // Unlike the CLI's, a block cut short by truncation still matches, up to the end of the text.
    [
        'private_key',
        /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$(?![\s\S]))/gu,
    ],
    // Dexto Cloud's own: API keys, the CLI's OAuth tokens, native refresh tokens, signed tokens.
    [
        'dexto_token',
        atStart(
            /(?:(?:dxt|dexto_mcp_(?:at|rt|code))_[A-Za-z0-9_-]{32,}|dexto_[a-z0-9_]+\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})/gu
        ),
    ],
    ['secret_key', atStart(/(?:sk-|[sr]k_(?:live|test)_|whsec_)[A-Za-z0-9_-]{16,}/gu)],
    ['github_token', atStart(/(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/gu)],
    ['gitlab_token', atStart(/glpat-[A-Za-z0-9_-]{20,}/gu)],
    ['npm_token', atStart(/npm_[A-Za-z0-9]{36,}/gu)],
    ['huggingface_token', atStart(/hf_[A-Za-z0-9]{30,}/gu)],
    ['digitalocean_token', atStart(/do[opr]_v1_[a-f0-9]{64}/gu)],
    ['aws_access_key', atStart(/(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu)],
    ['slack_token', atStart(/(?:xox[abprs]|xapp)-[A-Za-z0-9-]{10,}/gu)],
    [
        'slack_webhook',
        atStart(
            /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_/-]{16,}/gu
        ),
    ],
    ['google_api_key', atStart(/AIza[0-9A-Za-z_-]{35}/gu)],
    ['google_oauth', atStart(/(?:ya29\.|GOCSPX-)[A-Za-z0-9_-]{20,}/gu)],
    ['sendgrid_key', atStart(/SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/gu)],
    // Provider keys with a fixed prefix: Groq, xAI, Replicate, E2B, Supabase, Linear, Shopify, Sentry.
    [
        'api_key',
        atStart(
            /(?:gsk_|xai-|r8_|e2b_|sbp_|sb_secret_|lin_api_|shp(?:at|ca|pa|ss)_|sntry[su]_)[A-Za-z0-9_=-]{20,}/gu
        ),
    ],
    // A token whose signature was cut off still matches.
    ['jwt', atStart(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/gu)],
    ['bearer_token', atStart(/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gu)],
];

/** The kept prefix, then the secret: a URL's password and HTTP Basic credentials. */
const SECRET_SUFFIXES: readonly (readonly [kind: string, pattern: RegExp])[] = [
    [
        'url_password',
        atStart(
            /([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@[]{1,200}:)(?!\[redacted:)[^\s@/]{1,200}(?=@)/giu
        ),
    ],
    ['basic_auth', atStart(/(Authorization:\s*Basic\s+)[A-Za-z0-9+/=]{4,}/giu)],
];

// `password = value` and the like, in any case and inside longer names (`clientSecret`,
// `AWS_SECRET_ACCESS_KEY`): the name stays, the value goes, and a marker is never a value.
// Lengths are bounded so a long identifier can't make matching slow.
//
// A tool part's input is raw JSON, and a JSON string may itself hold JSON, so a double quote
// arrives escaped to any depth: `"`, `\"`, `\\\"`. At a depth whose quote is `q` backslashes and
// `"`, a backslash run before a `"` is `q` plus whole escaped backslashes (`q\`): an even count of
// them closes the value, an odd count is a quote inside it, and fewer than `q` ends the string
// holding the value, which the value never crosses.
const NAME = `${START}[\\w.-]{0,40}?`;
const VALUE_START = String.raw`(?:\\*["'])?\s*[:=]\s*`;
// The token pass runs first, so a value may start with a token's marker: the rest of the value
// still goes with it, and only a value that is nothing but a marker is left as it is.
const MARKER_VALUE = String.raw`\[redacted:[a-z_]+\]`;
const QUOTED = String.raw`(?<q>\\*)"(?!${MARKER_VALUE}\k<q>")(?:[^\\"\n]|\\+(?![\\"])|\k<q>\\(?:\k<q>\\\k<q>\\)*\k<q>"){1,200}?(?:\k<q>\\\k<q>\\)*\k<q>"|"(?!${MARKER_VALUE}")[^"\n]{1,200}"|'(?!${MARKER_VALUE}')[^'\n]{1,200}'`;
// Unquoted: a backslash run belongs to the value unless a quote follows it, so the value never
// ends inside an escape. A quote that never closes may be the end of the string around it, so
// the text after it is left alone.
const UNQUOTED_CHAR = String.raw`(?:[^\s"'[,;\\]|\\+(?![\\"]))`;
function assignmentValue(minLength: number): string {
    return `${QUOTED}|${MARKER_VALUE}${UNQUOTED_CHAR}+|${UNQUOTED_CHAR}{${minLength},}`;
}
const SECRET_ASSIGNMENTS = [
    // A password is a secret however short it is.
    new RegExp(
        `(${NAME}(?:password|passwd)[\\w.-]{0,40}${VALUE_START})(${assignmentValue(1)})`,
        'giu'
    ),
    new RegExp(
        `(${NAME}(?:secret|token|api[_-]?key|access[_-]?key|account[_-]?key|private[_-]?key|credentials?)[\\w.-]{0,40}${VALUE_START})(${assignmentValue(8)})`,
        'giu'
    ),
    // An environment variable named for a key or password (`STRIPE_KEY=`, `DB_PASS=`): upper case
    // only, since `cache_key = ...` in code is no secret.
    new RegExp(
        `(${START}[A-Z][A-Z0-9_]{0,40}_(?:KEY|PASS)${VALUE_START})(${assignmentValue(6)})`,
        'gu'
    ),
];

const MARKER = /\[redacted:([a-z_]+)\]|\[excluded: secret file(?: [^\]\n]*)?\]/gu;

/** The text with every credential shape replaced by its marker. Redacting twice changes nothing. */
export function redactSecrets(text: string): string {
    let redacted = text;
    for (const [kind, pattern] of SECRET_PATTERNS)
        redacted = redacted.replace(pattern, `[redacted:${kind}]`);
    for (const [kind, pattern] of SECRET_SUFFIXES)
        redacted = redacted.replace(
            pattern,
            (_match, prefix: string) => `${prefix}[redacted:${kind}]`
        );
    for (const pattern of SECRET_ASSIGNMENTS)
        redacted = redacted.replace(pattern, (_match, name: string, value: string) => {
            const quote = /^\\*["']/u.exec(value)?.[0] ?? '';
            return `${name}${quote}[redacted:assignment]${quote}`;
        });
    return redacted;
}

/** File names whose contents never leave the machine, matched on the path's last segment. */
const SECRET_FILE_NAME =
    /^(?:\.env(?:\..*)?|\.dev\.vars|.*\.(?:pem|key|p12|pfx|jks|keystore|tfstate|tfstate\.backup|tfvars)|id_(?:rsa|dsa|ecdsa|ed25519).*|\.npmrc|\.netrc|\.pgpass|\.pypirc|\.htpasswd|\.git-credentials|\.dockercfg|kubeconfig|credentials.*|service-account.*\.json|secrets?\.(?:json|ya?ml|toml)|token\.txt)$/iu;
// Stricter than the server's, which matches only a path inside one of these folders: the client
// also counts the folder itself (`cd ~/.kube`), where a command's later words name no secret file.
const SECRET_DIRECTORY = /(?:^|[\\/])\.(?:ssh|aws|gnupg|kube|docker)(?:[\\/]|$)/iu;
/** Also client-only: direnv's `.envrc`, which holds the same values as `.env`. */
const CLIENT_SECRET_FILE_NAME = /^\.envrc$/iu;
/** Names a glob such as `.env*` or `.e?v` is tested against: a glob that could match one is secret. */
const SECRET_NAME_SAMPLES = [
    '.env',
    '.env.local',
    '.envrc',
    '.dev.vars',
    'id_rsa',
    'id_ed25519',
    '.npmrc',
    '.netrc',
    '.pgpass',
    '.pypirc',
    '.git-credentials',
    'credentials',
    'secrets.json',
    'kubeconfig',
    'server.pem',
    'server.key',
];

/**
 * Whether a path is secret-shaped: its name, in any case, a glob that could match such a name,
 * or a secret directory, itself or on the way to it.
 */
export function isSecretPath(path: string): boolean {
    const name = path.split(/[\\/]/u).at(-1) ?? path;
    if (SECRET_FILE_NAME.test(name) || CLIENT_SECRET_FILE_NAME.test(name)) return true;
    if (SECRET_DIRECTORY.test(path)) return true;
    // A glob of wildcards alone (`*`, `.*`) names no file in particular.
    const literal = name.replaceAll(/[*?]|\[[^\]]*\]?/gu, '');
    return (
        /[*?[]/u.test(name) &&
        literal.length >= 2 &&
        SECRET_NAME_SAMPLES.some((sample) => globMatches(name, sample))
    );
}

/**
 * The least of a secret-shaped path that still shows it is one: from the secret folder on
 * (`.ssh/id_ed25519`), else its name (`.env`). The rest, such as the URL around it, stays here.
 */
export function secretPathTail(path: string): string {
    const folder = /(?:^|[\\/])(\.(?:ssh|aws|gnupg|kube|docker)(?:[\\/].*)?)$/iu.exec(path);
    if (folder?.[1] !== undefined) return folder[1];
    return path.split(/[\\/]/u).at(-1) ?? path;
}

function globMatches(glob: string, name: string): boolean {
    const pattern = glob
        .replaceAll(/[.+^${}()|\\]/gu, '\\$&')
        .replaceAll('*', '.*')
        .replaceAll('?', '.');
    try {
        return new RegExp(`^${pattern}$`, 'iu').test(name);
    } catch {
        // An unclosed `[`: count it as able to match.
        return true;
    }
}

/** The marker that replaces a tool's input and output for a secret-shaped path, or null for other paths. */
export function excludeSecretFile(path: string): string | null {
    if (!isSecretPath(path)) return null;
    const name = path.split(/[\\/]/u).at(-1) ?? path;
    // The name goes in only when it holds no secret and cannot end the marker early.
    const safe = redactSecrets(name) === name && !/[\]\n]/u.test(name);
    return safe ? `[excluded: secret file ${name}]` : '[excluded: secret file]';
}

/** The marker for the first secret-shaped file a command names, as `cat .env` does, or null. */
export function excludeSecretFileInCommand(command: string): string | null {
    const path = secretPathIn(command);
    return path === null ? null : excludeSecretFile(path);
}

/**
 * The first secret-shaped path a text names, such as a command's `.env` or a search result's
 * `"file":"/repo/.env"`, or null. JSON-escaped text (`\"cat .env\"`, `.env\ncat x`) splits at
 * backslashes too; the words kept whole still catch a Windows path such as `.ssh\config`.
 */
export function secretPathIn(text: string): string | null {
    const words = [
        ...text.split(/[\s"'`=<>|;&(),:[\]{}]+/u),
        ...text.split(/[\s"'`=<>|;&(),:[\]{}\\]+/u),
    ];
    return words.find((word) => word.length > 0 && isSecretPath(word)) ?? null;
}

/** How many redaction and exclusion markers of each kind the text holds. */
export function countMarkers(text: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const match of text.matchAll(MARKER)) {
        const kind = match[1] ?? 'secret_file';
        counts[kind] = (counts[kind] ?? 0) + 1;
    }
    return counts;
}
