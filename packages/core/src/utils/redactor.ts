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

// AWS access key ids. A signed URL (see SIGNED_URL_PATTERNS) is left whole: its key id, its token
// and its object name are part of a link that is meant to be shared and stops working if changed.
const AWS_ACCESS_KEY_ID_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;

// One capture group, so String.split keeps each URL at an odd index. A URL is read only over the
// characters a signed link uses (letters, digits, -._~/?&=%:+) and not into another http(s)://, so a
// field written right after a link (",token=", "|token=", ")[next](") is not part of it. A signed
// URL with any other character in it is then only partly recognised and gets redacted, which errs
// toward redacting.
const URL_PATTERN = /(https?:\/\/(?:(?!https?:\/\/)[A-Za-z0-9._~/?&=%:+-])+)/i;
// Stands in for a signed URL while the other patterns run, so none of them can change it. Its
// delimiter is a private-use character, which ordinary text does not contain.
const SIGNED_URL_PLACEHOLDER = /\uE000(\d+)\uE000/g;

// JWT pattern - applied selectively (not to signed URLs)
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g;

// Patterns that indicate a URL contains a signed token that should NOT be redacted
// These are legitimate shareable URLs, not sensitive credentials
const SIGNED_URL_PATTERNS = [
    /supabase\.co\/storage\/.*\?token=/i, // Supabase signed URLs
    /\.r2\.cloudflarestorage\.com\/.*\?/i, // Cloudflare R2 signed URLs
    // AWS S3 presigned URLs, virtual-hosted (bucket.s3.region...), path-style (s3.region.../bucket) and
    // S3 Express zonal (bucket--zone--x-s3.s3express-zone.region...).
    // The S3 host must be the URL's own host, not text in another URL's path, and made of whole
    // labels ending in amazonaws.com (amazonaws.com.cn in AWS China), so evilamazonaws.com is not.
    // The link must carry its signature as well as its key id: SigV4 or SigV2.
    /^https?:\/\/(?:[^/?#.\s]+\.)*(?:s3[.-]|s3express-)(?:[^/?#.\s]+\.)*amazonaws\.com(?:\.cn)?\/(?=[^#]*[?&]X-Amz-Credential=)(?=[^#]*[?&]X-Amz-Signature=)/i,
    /^https?:\/\/(?:[^/?#.\s]+\.)*(?:s3[.-]|s3express-)(?:[^/?#.\s]+\.)*amazonaws\.com(?:\.cn)?\/(?=[^#]*[?&]AWSAccessKeyId=)(?=[^#]*[?&]Signature=)/i,
    /storage\.googleapis\.com\/.*\?/i, // Google Cloud Storage signed URLs
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

export function redactSensitiveData(input: unknown, seen = new WeakSet()): unknown {
    if (typeof input === 'string') {
        // Each signed URL is set aside first and left whole: its key id, token and object name are
        // part of a link that is meant to be shared and stops working if changed. Everything
        // else, including text right next to a signed URL, goes through every pattern. Text that
        // already holds the placeholder's delimiter gets no exemption at all.
        const signedUrls: string[] = [];
        let result = input.includes('\uE000')
            ? input
            : input
                  .split(URL_PATTERN)
                  .map((part, index) => {
                      if (index % 2 === 0 || !isSignedUrl(part)) return part;
                      signedUrls.push(part);
                      return `\uE000${signedUrls.length - 1}\uE000`;
                  })
                  .join('');
        for (const pattern of SENSITIVE_PATTERNS) {
            result = result.replace(pattern, REDACTED);
        }
        result = result.replace(SK_KEY_CANDIDATE_PATTERN, (candidate) =>
            isSkKey(candidate) ? REDACTED : candidate
        );
        result = result.replace(AWS_ACCESS_KEY_ID_PATTERN, REDACTED).replace(JWT_PATTERN, REDACTED);
        return signedUrls.length === 0
            ? result
            : result.replace(
                  SIGNED_URL_PLACEHOLDER,
                  (_placeholder, index: string) => signedUrls[Number(index)] ?? REDACTED
              );
    }
    if (Array.isArray(input)) {
        if (seen.has(input)) return REDACTED_CIRCULAR;
        seen.add(input);
        return input.map((item) => redactSensitiveData(item, seen));
    }
    if (input && typeof input === 'object') {
        if (seen.has(input)) return REDACTED_CIRCULAR;
        seen.add(input);
        const result: any = {};
        for (const [key, value] of Object.entries(input)) {
            if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
                result[key] = REDACTED;
            } else {
                // First truncate file data (with parent context), then recursively redact
                const truncatedValue = truncateFileData(
                    value,
                    key,
                    input as Record<string, unknown>
                );
                result[key] = redactSensitiveData(truncatedValue, seen);
            }
        }
        return result;
    }
    return input;
}
