/**
 * Utility to redact sensitive information from objects, arrays, and strings.
 * - Redacts by field name (e.g., apiKey, token, password, etc.)
 * - Redacts by value pattern (e.g., OpenAI keys, Bearer tokens, emails)
 * - Handles deeply nested structures and circular references
 * - Recursive and preserves structure
 * - Easy to extend
 */

// List of sensitive field names to redact (case-insensitive)
const SENSITIVE_FIELDS = [
    'apikey',
    'api_key',
    'token',
    'access_token',
    'refresh_token',
    'password',
    'secret',
    'client_secret',
    'private_key',
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
];

// List of file data field names that should be truncated for logging
const FILE_DATA_FIELDS = [
    'base64',
    'filedata',
    'file_data',
    'imagedata',
    'image_data',
    'audiodata',
    'audio_data',
    'data',
];

// List of regex patterns to redact sensitive values
const SENSITIVE_PATTERNS: RegExp[] = [
    // PEM private key block, through its end line or the end of the text if it was cut off
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    /\b[sr]k_(?:live|test|org)_[A-Za-z0-9_]{16,}/g, // Stripe secret, restricted and organization keys
    // GitHub tokens (ghp_, gho_, ghu_, ghr_, ghs_). App installation tokens (ghs_) may be the
    // long stateless form, which has dots, hyphens and underscores after the prefix.
    /\b(?:gh[pour]_[A-Za-z0-9]{36,}|ghs_[A-Za-z0-9._-]{36,})/g,
    /\bgithub_pat_[A-Za-z0-9_]{22,}/g, // GitHub fine-grained tokens
    // Slack tokens: bot, user and refresh (xoxb-, xoxp-, xoxe-, ...) and app-level (xapp-, xoxe.xapp-),
    // and workflow tokens (xwfp-)
    /\b(?:xox[a-z]-|xoxe\.xapp-|xapp-|xwfp-)[A-Za-z0-9-]{10,}/g,
    /\bya29\.[A-Za-z0-9_-]{20,}/g, // Google OAuth access tokens
    /\bBearer\s+[A-Za-z0-9\-_.=]+\b/gi, // Bearer tokens
    // Emails. The local part is capped at its legal 64 characters: unbounded, a long run of
    // word characters with no "@" was rescanned from every word boundary (quadratic).
    /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

// sk- keys, hyphens and underscores included: OpenAI (sk-, sk-proj-) and Anthropic
// (sk-ant-api03-, sk-ant-oat01-, sk-ant-ort01-). The pattern takes the whole run of key
// characters in one pass; isSkKey then decides, so no input makes the scan quadratic.
const SK_KEY_CANDIDATE_PATTERN = /\bsk-[A-Za-z0-9_-]{20,}/g;

/**
 * A candidate with a hyphen or underscore must also contain a digit, so a long hyphenated
 * word that starts with "sk-" is left alone.
 */
function isSkKey(candidate: string): boolean {
    const body = candidate.slice('sk-'.length);
    return /\d/.test(body) || !/[-_]/.test(body);
}

// AWS access key ids. In a signed URL (see SIGNED_URL_PATTERNS) its own credential key id is kept:
// it is part of a link that is meant to be shared and stops working if changed.
const AWS_ACCESS_KEY_ID_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
// Inside a signed URL, its own credential key id is the one kept.
const AWS_ACCESS_KEY_ID_OUTSIDE_CREDENTIAL_PATTERN =
    /(?<![?&]X-Amz-Credential=)(?<![?&]AWSAccessKeyId=)\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;

// One capture group, so String.split keeps each URL at an odd index. A URL is read only over the
// characters a signed link uses (letters, digits, -._~/?&=%+) and not into another http(s)://,
// so a field written right after a link (",token=", "|token=", ":token=", ")[next](") is not
// part of it. A signed URL with any other character in it, a port included, is then only partly
// recognised and gets redacted, which errs toward redacting. A field joined with "&" cannot be
// told from the link's own query and is kept with it.
const URL_PATTERN = /(https?:\/\/(?:(?!https?:\/\/)[A-Za-z0-9._~/?&=%+-])+)/i;
// Stands in for a signed URL while the patterns run on the text around it. Its
// delimiter is a private-use character, which ordinary text does not contain.
const SIGNED_URL_PLACEHOLDER = /\uE000(\d+)\uE000/g;

// JWTs: eyJ at a word boundary, then three dot-separated segments of token characters. Read as
// one pattern, a long run of "eyJ…-" with no dot is rescanned from every eyJ in it (quadratic),
// so each run of token characters with the two dots a token needs is taken once and
// redactJwtsInRun finds the tokens inside it.
const JWT_RUN_PATTERN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*){2,}/g;
// Inside a signed URL, the token that is its token= query value (Supabase's signature) is kept.
const TOKEN_VALUE_PREFIX = /[?&]token=$/;

// Patterns that indicate a URL contains a signed token that should NOT be redacted
// These are legitimate shareable URLs, not sensitive credentials
const SIGNED_URL_PATTERNS = [
    // Each provider's link counts as signed only on its own host and with a non-empty signature
    // in its query (after the "?") that has the provider's own shape: a 64-hex SigV4 signature, a
    // base64 SigV2 or GCS V2 one, a long hex GCS V4 one, or a JWT for Supabase. A public link, an
    // unsigned one or one with a placeholder value gets no exemption.
    // Supabase signed URLs: the token is the signature.
    /^https?:\/\/[^/?#\s]+\.supabase\.co\/storage\/v1\/object\/sign\/[^?#]*\?(?:[^#]*&)?token=eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i,
    // Cloudflare R2 presigned URLs (SigV4).
    /^https?:\/\/[^/?#\s]+\.r2\.cloudflarestorage\.com\/(?=[^?#]*\?(?:[^#]*&)?X-Amz-Signature=[0-9a-f]{64}(?![0-9a-z]))/i,
    // AWS S3 presigned URLs, virtual-hosted (bucket.s3.region...), path-style (s3.region.../bucket) and
    // S3 Express zonal (bucket--zone--x-s3.s3express-zone.region...).
    // The S3 host must be the URL's own host, not text in another URL's path, and made of whole
    // labels ending in amazonaws.com (amazonaws.com.cn in AWS China), so evilamazonaws.com is not.
    // The link must carry its signature as well as its key id: SigV4 or SigV2.
    /^https?:\/\/(?:[^/?#.\s]+\.)*(?:s3[.-]|s3express-)(?:[^/?#.\s]+\.)*amazonaws\.com(?:\.cn)?\/(?=[^?#]*\?(?:[^#]*&)?X-Amz-Credential=(?:AKIA|ASIA)[A-Z0-9]{16}(?:%2F|\/)\d{8}(?:%2F|\/)[a-z0-9-]+(?:%2F|\/)[a-z0-9-]+(?:%2F|\/)aws4_request)(?=[^?#]*\?(?:[^#]*&)?X-Amz-Signature=[0-9a-f]{64}(?![0-9a-z]))/i,
    /^https?:\/\/(?:[^/?#.\s]+\.)*(?:s3[.-]|s3express-)(?:[^/?#.\s]+\.)*amazonaws\.com(?:\.cn)?\/(?=[^?#]*\?(?:[^#]*&)?AWSAccessKeyId=(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9]))(?=[^?#]*\?(?:[^#]*&)?Signature=[A-Za-z0-9%+/=]{20,})/i,
    // Google Cloud Storage signed URLs: V4 (X-Goog-Signature) or V2 (Signature).
    /^https?:\/\/(?:[^/?#\s]+\.)?storage\.googleapis\.com\/(?=[^?#]*\?(?:[^#]*&)?(?:X-Goog-Signature=[0-9a-f]{64,}|Signature=[A-Za-z0-9%+/=]{20,}))/i,
];

const REDACTED = '[REDACTED]';
const REDACTED_CIRCULAR = '[REDACTED_CIRCULAR]';
const FILE_DATA_TRUNCATED = '[FILE_DATA_TRUNCATED]';

/**
 * Determines if a string looks like base64-encoded file data
 * @param value - String to check
 * @returns true if it appears to be large base64 data
 */
function isLargeBase64Data(value: string): boolean {
    // Check if it's a long string that looks like base64
    return value.length > 1000 && /^[A-Za-z0-9+/=]{1000,}$/.test(value.substring(0, 1000));
}

/**
 * Truncates large file data for logging purposes
 * @param value - The value to potentially truncate
 * @param key - The field name
 * @param parent - The parent object for context checking
 * @returns Truncated value with metadata or original value
 */
function truncateFileData(value: unknown, key: string, parent?: Record<string, unknown>): unknown {
    if (typeof value !== 'string') return value;
    const lowerKey = key.toLowerCase();
    // Gate "data" by presence of file-ish sibling metadata to avoid false positives
    const hasFileContext =
        !!parent && ('mimeType' in parent || 'filename' in parent || 'fileName' in parent);
    const looksLikeFileField =
        FILE_DATA_FIELDS.includes(lowerKey) || (lowerKey === 'data' && hasFileContext);
    if (looksLikeFileField && isLargeBase64Data(value)) {
        // Only log a concise marker + size; no content preview to prevent leakage
        return `${FILE_DATA_TRUNCATED} (${value.length} chars)`;
    }
    return value;
}

/**
 * Redacts sensitive data from an object, array, or string.
 * Handles circular references gracefully.
 * @param input - The data to redact
 * @param seen - Internal set to track circular references
 * @returns The redacted data
 */
/**
 * Checks if a string is a signed URL that should not have its token redacted
 */
function isSignedUrl(value: string): boolean {
    return SIGNED_URL_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Replaces each JWT in a dotted run of token characters. A token starts at "eyJ" at the start of
 * a segment or just after a "-" in it (a word boundary), and spans the rest of that segment and
 * the next two whole segments. Each segment is read once.
 */
function redactJwtsInRun(run: string, keepRunStart: boolean): string {
    const segments = run.split('.');
    const kept: string[] = [];
    let index = 0;
    while (index < segments.length) {
        const segment = segments[index] ?? '';
        const start =
            index + 2 < segments.length ? jwtStart(segment, keepRunStart && index === 0) : -1;
        if (start < 0) {
            kept.push(segment);
            index += 1;
            continue;
        }
        kept.push(`${segment.slice(0, start)}${REDACTED}`);
        index += 3;
    }
    return kept.join('.');
}

/** Where the first JWT header starts in a segment, or -1. */
function jwtStart(segment: string, skipSegmentStart: boolean): number {
    let start = segment.indexOf('eyJ');
    while (start >= 0) {
        if (start === 0 ? !skipSegmentStart : segment[start - 1] === '-') return start;
        start = segment.indexOf('eyJ', start + 1);
    }
    return -1;
}

function redactText(text: string, awsAccessKeyIdPattern: RegExp, keepTokenValue: boolean): string {
    let result = text;
    for (const pattern of SENSITIVE_PATTERNS) {
        result = result.replace(pattern, REDACTED);
    }
    result = result.replace(SK_KEY_CANDIDATE_PATTERN, (candidate) =>
        isSkKey(candidate) ? REDACTED : candidate
    );
    result = result.replace(awsAccessKeyIdPattern, REDACTED);
    if (!result.includes('eyJ')) return result;
    return result.replace(JWT_RUN_PATTERN, (run: string, offset: number, whole: string) =>
        redactJwtsInRun(
            run,
            keepTokenValue && TOKEN_VALUE_PREFIX.test(whole.slice(Math.max(0, offset - 7), offset))
        )
    );
}

function redactString(input: string): string {
    // Each signed URL is set aside first, so the patterns run on the rest with its context
    // intact, and is put back redacted in the same way except for what makes it a working
    // link: its own credential key id and its token= value. Any other key id or token in it,
    // object name included, is redacted. Text that already holds the placeholder's delimiter
    // gets no exemption at all.
    const signedUrls: string[] = [];
    const withPlaceholders = input.includes('\uE000')
        ? input
        : input
              .split(URL_PATTERN)
              .map((part, index) => {
                  if (index % 2 === 0 || !isSignedUrl(part)) return part;
                  signedUrls.push(part);
                  return `\uE000${signedUrls.length - 1}\uE000`;
              })
              .join('');
    const result = redactText(withPlaceholders, AWS_ACCESS_KEY_ID_PATTERN, false);
    return signedUrls.length === 0
        ? result
        : result.replace(SIGNED_URL_PLACEHOLDER, (_placeholder, index: string) => {
              const url = signedUrls[Number(index)];
              return url === undefined
                  ? REDACTED
                  : redactText(url, AWS_ACCESS_KEY_ID_OUTSIDE_CREDENTIAL_PATTERN, true);
          });
}

/**
 * How a value is treated while redacting. API responses and logs share one walk, but a log
 * also masks by broader key names and by "name=value" text, which would corrupt API payloads
 * (for example a `nextPageToken` or a public `posthogKey`).
 */
type Mode = 'response' | 'log';

const MAX_LOG_DEPTH = 20;
// A log entry is read for at most this many objects, so a densely linked graph (every node
// pointing at every other) cannot be walked once per path.
const MAX_LOG_NODES = 5000;
const TRUNCATED = '[Truncated]';

/** The text a logger writes when it could not redact an entry, never the entry itself. */
export const UNREDACTABLE_LOG_DATA = '[unredactable log data]';

/** State of one redaction call. */
interface Walk {
    /** Objects on the path being read, to mark a real cycle. */
    ancestors: WeakSet<object>;
    /** Results already made, so a value reached twice is read once (API responses). */
    memo: WeakMap<object, unknown> | undefined;
    /** Objects this call may still read (logs). */
    remaining: number;
}

/** Values that hold no keys to look at: how many bytes, not the bytes. */
function describeBinary(value: ArrayBuffer | ArrayBufferView): string {
    const name = value instanceof ArrayBuffer ? 'ArrayBuffer' : value.constructor.name;
    return `[${name} ${value.byteLength} bytes]`;
}

function redactValue(
    input: unknown,
    walk: Walk,
    mode: Mode,
    insideSecret: boolean,
    depth = 0
): unknown {
    if (typeof input === 'string') {
        if (insideSecret) return REDACTED;
        const redacted = redactString(input);
        return mode === 'log' ? redactKeyValueText(redacted) : redacted;
    }
    if (typeof input !== 'object' || input === null) return input;

    if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) return describeBinary(input);
    if (input instanceof Date) {
        return Number.isNaN(input.getTime()) ? 'Invalid Date' : input.toISOString();
    }
    if (input instanceof RegExp) return String(input);
    if (input instanceof URL) {
        const withoutCredentials = new URL(input.href);
        withoutCredentials.username = '';
        withoutCredentials.password = '';
        return redactValue(withoutCredentials.href, walk, mode, insideSecret, depth);
    }

    if (walk.ancestors.has(input)) return REDACTED_CIRCULAR;
    const memoized = walk.memo?.get(input);
    if (memoized !== undefined) return memoized;
    if (mode === 'log' && depth >= MAX_LOG_DEPTH) return TRUNCATED;
    if (walk.remaining <= 0) return TRUNCATED;
    walk.remaining -= 1;

    walk.ancestors.add(input);
    try {
        const result = redactContainer(input, walk, mode, insideSecret, depth + 1);
        walk.memo?.set(input, result);
        return result;
    } finally {
        walk.ancestors.delete(input);
    }
}

/** An Error as log data: its name, message, stack and cause, its own fields and its toJSON. */
function errorFields(error: Error): Record<string, unknown> {
    const toJSON: unknown = Reflect.get(error, 'toJSON');
    const json: unknown = typeof toJSON === 'function' ? toJSON.call(error) : undefined;
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error.cause !== undefined && { cause: error.cause }),
        ...Object.fromEntries(Object.entries(error)),
        ...(typeof json === 'object' && json !== null
            ? Object.fromEntries(Object.entries(json))
            : {}),
    };
}

function redactContainer(
    input: object,
    walk: Walk,
    mode: Mode,
    insideSecret: boolean,
    depth: number
): unknown {
    if (Array.isArray(input) || input instanceof Set) {
        return [...input].map((item) => redactValue(item, walk, mode, insideSecret, depth));
    }
    if (input instanceof Map) {
        return [...input].map(([key, value]) => [
            redactValue(key, walk, mode, insideSecret, depth),
            redactEntry(String(key), value, walk, mode, insideSecret, depth),
        ]);
    }
    const fields =
        mode === 'log' && input instanceof Error
            ? errorFields(input)
            : Object.fromEntries(Object.entries(input));
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
        if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
            result[key] = REDACTED;
            continue;
        }
        // First truncate file data (with parent context), then recursively redact
        const truncatedValue = truncateFileData(value, key, fields);
        result[key] = redactEntry(key, truncatedValue, walk, mode, insideSecret, depth);
    }
    return result;
}

/**
 * One value under its key. In a log, every string under an env or headers map is masked, and a
 * secret-named key masks its own string value (or the strings in its array); an object under
 * such a name is read by its own key names.
 */
function redactEntry(
    key: string,
    value: unknown,
    walk: Walk,
    mode: Mode,
    insideSecret: boolean,
    depth: number
): unknown {
    if (mode === 'log' && !insideSecret) {
        if (isSecretMapKey(key) && isPlainObject(value)) {
            return redactValue(value, walk, mode, true, depth);
        }
        if (isSensitiveLogKey(key)) {
            if (typeof value === 'string') return REDACTED;
            if (Array.isArray(value)) {
                return value.map((item) =>
                    typeof item === 'string'
                        ? REDACTED
                        : redactValue(item, walk, mode, false, depth)
                );
            }
        }
    }
    return redactValue(value, walk, mode, insideSecret, depth);
}

function isPlainObject(value: unknown): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redactSensitiveData(input: unknown, seen = new WeakSet<object>()): unknown {
    return redactValue(
        input,
        { ancestors: seen, memo: new WeakMap(), remaining: Infinity },
        'response',
        false
    );
}

// ---- Logs ----
//
// Both loggers (the winston GlobalLogger and the structured DextoLogger) call these two
// functions, so what a log hides does not depend on which logger wrote it.

// Key names that hold a secret, matched on the name with separators and case removed: it is or
// ends in one of these (client_secret, X-Api-Key, accessToken, DB_PASSWORD). A name that only
// mentions one (secretName, cookieName, tokenizer, tokenUsage, credentials: 'include') does not.
// Only string values under such a key are masked: a number or boolean (maxTokens, hasApiKey) is
// not a secret and stays readable.
const SENSITIVE_KEY_SUFFIXES = [
    'token',
    'secret',
    'secrets',
    'password',
    'passwd',
    'passphrase',
    'bearer',
    'credential',
    'authorization',
    'cookie',
    'cookies',
    'apikey',
    'apikeys',
    'privatekey',
    'accesskey',
    'secretkey',
    'signingkey',
    'encryptionkey',
];
// A map whose every string value is masked, names kept: env and header maps.
const SECRET_MAP_KEYS = new Set(['env', 'envvars', 'environment', 'headers']);

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveLogKey(key: string): boolean {
    const normalized = normalizeKey(key);
    return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function isSecretMapKey(key: string): boolean {
    return SECRET_MAP_KEYS.has(normalizeKey(key));
}

// Authorization, cookie and API key header lines hold spaces ("Bearer abc", "a=1; b=2"), so an unquoted
// value runs to the end of the line.
const HEADER_LINE_PATTERN =
    /(?<![A-Za-z0-9_-])((?:proxy-)?authorization|(?:set-)?cookie|x-api-key|x-auth-token)(\s*[:=]\s*)(?!["'\\])[^\r\n]*/gi;

// name=value or name: value, read in two steps. The name (tried only from a word edge) is found
// first, and the value is read only after a secret-named key. A name that is not secret is passed
// over alone, so "url=https://h/p?token=abc" still gets its token= looked at, and no input makes
// the scan quadratic. A value is quoted (also as JSON escaped inside a string) or unquoted up to a
// separator; a quote that never closes, or runs past the cap, masks the rest of the line.
const NAME_PATTERN = /(?<![A-Za-z0-9_.-])([A-Za-z][A-Za-z0-9_.-]*)(\\?["']?)(\s*[:=]\s*)/g;
const VALUE_PATTERN =
    /\\"(?:[^"\\]|\\(?!")){0,4096}?\\"|"(?:[^"\\]|\\.){0,4096}"|'(?:[^'\\]|\\.){0,4096}'|[^\s,;&"'}\])\\]+|["'\\][^\r\n]*/y;

// env: { A: "b" } or "headers":{"A":"b"}. These maps are flat, so one level is enough.
const SECRET_MAP_TEXT_PATTERN =
    /(?<![A-Za-z0-9_-])(env|envvars|environment|headers)(\\?["']?\s*[:=]\s*)\{([^{}]{0,8192})\}/gi;
const MAP_ENTRY_PATTERN =
    /((?:\\?["'])?[A-Za-z0-9_.-]{1,128}(?:\\?["'])?\s*[:=]\s*)(\\"(?:[^"\\]|\\(?!")){0,4096}?\\"|"(?:[^"\\]|\\.){0,4096}"|'(?:[^'\\]|\\.){0,4096}'|[^\s,}]+)/g;

// A number or boolean written without quotes is not a secret (maxTokens: 4096).
const PLAIN_VALUE_PATTERN = /^(?:\d+(?:\.\d+)?|true|false|null|undefined)$/i;

/** A quoted value, one with a digit or symbol in it, or a long one: not an ordinary word. */
function looksLikeCredential(value: string): boolean {
    return /^[\\"']/.test(value) || /[^A-Za-z]/.test(value) || value.length >= 16;
}

/** The mask, in the same quotes the value had. */
function maskedLike(value: string): string {
    for (const quote of ['\\"', '"', "'"]) {
        if (value.length >= quote.length * 2 && value.startsWith(quote) && value.endsWith(quote)) {
            return `${quote}${REDACTED}${quote}`;
        }
    }
    return REDACTED;
}

function redactKeyValueText(text: string): string {
    const withMaps = text
        .replace(
            HEADER_LINE_PATTERN,
            (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`
        )
        .replace(
            SECRET_MAP_TEXT_PATTERN,
            (_match, name: string, separator: string, entries: string) =>
                `${name}${separator}{${entries.replace(
                    MAP_ENTRY_PATTERN,
                    (_entry, prefix: string, value: string) => `${prefix}${maskedLike(value)}`
                )}}`
        );

    const names = new RegExp(NAME_PATTERN);
    const values = new RegExp(VALUE_PATTERN);
    let result = '';
    let copiedUpTo = 0;
    for (let found = names.exec(withMaps); found; found = names.exec(withMaps)) {
        if (!isSensitiveLogKey(found[1] ?? '')) continue;
        values.lastIndex = names.lastIndex;
        const value = values.exec(withMaps)?.[0];
        if (value === undefined) continue;
        names.lastIndex = values.lastIndex;
        if (value.startsWith(REDACTED.slice(0, -1)) || PLAIN_VALUE_PATTERN.test(value)) continue;
        // "name: value" is also how a sentence reads ("Failed to refresh token: network error"),
        // so after a colon only a value that looks like a credential is masked.
        if (!found[3]?.includes('=') && !looksLikeCredential(value)) continue;
        result += withMaps.slice(copiedUpTo, values.lastIndex - value.length) + maskedLike(value);
        copiedUpTo = values.lastIndex;
    }
    return result + withMaps.slice(copiedUpTo);
}

/** Redacts one log message: known secret shapes, then the value of any secret-named key. */
export function redactLogText(text: string): string {
    return redactKeyValueText(redactString(text));
}

/**
 * A log message of any type, as redacted text. Never throws: an entry that cannot be read is
 * replaced by UNREDACTABLE_LOG_DATA, not passed on as it was.
 */
export function redactLogMessage(message: unknown): string {
    try {
        return redactLogText(typeof message === 'string' ? message : String(message));
    } catch {
        return UNREDACTABLE_LOG_DATA;
    }
}

/**
 * A log record (context or metadata) with secrets masked, leaving out `skip`. Never throws: a
 * record that cannot be read (a throwing getter, a revoked proxy) becomes one key holding
 * UNREDACTABLE_LOG_DATA, not the record itself.
 */
export function redactLogRecord(
    record: object,
    skip: readonly string[] = []
): Record<string, unknown> {
    try {
        const entries = Object.entries(record).filter(([key]) => !skip.includes(key));
        const redacted = redactValue(
            Object.fromEntries(entries),
            { ancestors: new WeakSet(), memo: undefined, remaining: MAX_LOG_NODES },
            'log',
            false
        );
        if (typeof redacted !== 'object' || redacted === null || Array.isArray(redacted)) {
            return { redacted: UNREDACTABLE_LOG_DATA };
        }
        return Object.fromEntries(Object.entries(redacted));
    } catch {
        return { redacted: UNREDACTABLE_LOG_DATA };
    }
}
