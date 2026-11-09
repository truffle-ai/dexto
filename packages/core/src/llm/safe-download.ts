import { promises as dns, type LookupAddress, type LookupOptions } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { DownloadError, type Experimental_DownloadFunction as DownloadFunction } from 'ai';
import { isPrivateAddress } from './private-address.js';

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const DOWNLOAD_TIMEOUT_MS = 60_000;

type DnsLookup = (
    hostname: string,
    options: { all: true; verbatim: true }
) => Promise<LookupAddress[]>;

export interface SafeDownloadOptions {
    /** Resolves a host name to every address it has. Replaced in tests. */
    dnsLookup?: DnsLookup;
    /** Decides which resolved addresses are refused. Replaced in tests. */
    isBlockedAddress?: (address: string) => boolean;
}

type LookupCallback = (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number
) => void;

/**
 * A `lookup` for node:http(s) that resolves the host itself and refuses private answers. The
 * connection then uses the address that was checked, so a name that answers differently to a
 * second lookup (DNS rebinding) cannot reach a private address.
 */
function createCheckedLookup(
    dnsLookup: DnsLookup,
    isBlockedAddress: (address: string) => boolean
): (hostname: string, options: LookupOptions, callback: LookupCallback) => void {
    return (hostname, options, callback) => {
        dnsLookup(hostname, { all: true, verbatim: true }).then(
            (records) => {
                const blocked = records.find((record) => isBlockedAddress(record.address));
                if (blocked) {
                    callback(
                        new Error(`${hostname} resolves to private address ${blocked.address}`),
                        []
                    );
                    return;
                }
                const [first] = records;
                if (!first) {
                    callback(new Error(`Failed to resolve ${hostname}`), []);
                    return;
                }
                if (options.all) {
                    callback(null, records);
                    return;
                }
                callback(null, first.address, first.family);
            },
            (error: NodeJS.ErrnoException) => callback(error, [])
        );
    };
}

function requestOnce(
    url: URL,
    lookup: ReturnType<typeof createCheckedLookup>,
    signal: AbortSignal
): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        const request = (url.protocol === 'https:' ? https : http).request(
            url,
            { method: 'GET', lookup, signal },
            resolve
        );
        request.on('error', reject);
        request.end();
    });
}

async function readLimited(response: IncomingMessage, url: string): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > MAX_DOWNLOAD_BYTES) {
            response.destroy();
            throw new DownloadError({
                url,
                message: `Download of ${url} exceeded maximum size of ${MAX_DOWNLOAD_BYTES} bytes.`,
            });
        }
        chunks.push(buffer);
    }
    return new Uint8Array(Buffer.concat(chunks));
}

/**
 * The AI SDK downloads the URLs of images and files in a prompt itself, and its own check looks
 * at the host name text only, so a name that resolves to a private address is fetched. This
 * downloader resolves the host, refuses private answers, connects to the address it checked and
 * checks every redirect the same way. URLs the model fetches itself are left to the model.
 */
export function createSafeDownload(options: SafeDownloadOptions = {}): DownloadFunction {
    const isBlockedAddress = options.isBlockedAddress ?? isPrivateAddress;
    const lookup = createCheckedLookup(
        options.dnsLookup ?? ((hostname, lookupOptions) => dns.lookup(hostname, lookupOptions)),
        isBlockedAddress
    );

    async function download(first: URL) {
        const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
        let url = first;
        for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                throw new DownloadError({
                    url: url.toString(),
                    message: `URL scheme must be http or https, got ${url.protocol}`,
                });
            }
            // An IP literal is connected to without a lookup, so it is checked here.
            if (isBlockedAddress(url.hostname)) {
                throw new DownloadError({
                    url: url.toString(),
                    message: `Download from private address ${url.hostname} is blocked`,
                });
            }
            const response = await requestOnce(url, lookup, signal).catch((cause) => {
                throw new DownloadError({ url: url.toString(), cause });
            });
            const location = response.headers.location;
            const status = response.statusCode ?? 0;
            if (status >= 300 && status < 400 && location) {
                response.resume();
                url = new URL(location, url);
                continue;
            }
            if (status < 200 || status >= 300) {
                response.resume();
                throw new DownloadError({
                    url: url.toString(),
                    statusCode: status,
                    statusText: response.statusMessage ?? '',
                });
            }
            const data = await readLimited(response, url.toString());
            const contentType = response.headers['content-type']?.split(';')[0]?.trim();
            return { data, mediaType: contentType || undefined };
        }
        throw new DownloadError({
            url: first.toString(),
            message: `Too many redirects (max ${MAX_REDIRECTS})`,
        });
    }

    return (requests) =>
        Promise.all(
            requests.map(({ url, isUrlSupportedByModel }) =>
                isUrlSupportedByModel ? null : download(url)
            )
        );
}
