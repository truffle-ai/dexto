import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Cloud instance metadata services answer requests from the machine they run on with
 * credentials. Tools that fetch a URL chosen by a model or a caller must never reach them.
 *
 * Blocked: link-local addresses (169.254.0.0/16 and fe80::/10, which include the AWS, Azure and
 * GCP metadata address), the AWS IPv6 metadata address, the Alibaba Cloud metadata address and
 * the well-known metadata host names. Loopback and other private addresses are not blocked here.
 */
const METADATA_HOSTNAMES = new Set([
    'metadata.google.internal',
    'metadata.goog',
    'instance-data',
    'instance-data.ec2.internal',
]);

type Resolve = (hostname: string) => Promise<string[]>;

async function resolveAllAddresses(hostname: string): Promise<string[]> {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
}

function isMetadataIpv4(a: number, b: number, c: number, d: number): boolean {
    return (a === 169 && b === 254) || (a === 100 && b === 100 && c === 100 && d === 200);
}

/** Expand a compressed IPv6 address (as printed by the URL parser) into eight 16-bit groups. */
function ipv6Groups(address: string): number[] {
    const [head = '', tail] = address.split('::');
    const headGroups = head === '' ? [] : head.split(':');
    const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':');
    const missing = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
    const groups = [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];
    return groups.map((group) => Number.parseInt(group, 16));
}

function isMetadataIpv6(address: string): boolean {
    // The URL parser normalises case, zero runs and dotted IPv4 tails.
    const normalized = new URL(`http://[${address.split('%')[0]}]/`).hostname.slice(1, -1);
    const g = ipv6Groups(normalized);
    const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;

    if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10
    if (g0 === 0xfd00 && g1 === 0x0ec2 && g2 + g3 + g4 + g5 + g6 === 0 && g7 === 0x0254) {
        return true; // AWS IPv6 metadata address
    }

    const v4 = (high: number, low: number) =>
        isMetadataIpv4(high >> 8, high & 255, low >> 8, low & 255);
    const upperZero = g0 + g1 + g2 + g3 === 0;
    if (upperZero && g4 === 0 && g5 === 0xffff) return v4(g6, g7); // ::ffff:a.b.c.d (mapped)
    if (upperZero && g4 === 0xffff && g5 === 0) return v4(g6, g7); // ::ffff:0:a.b.c.d (translated)
    if (upperZero && g4 === 0 && g5 === 0) return v4(g6, g7); // ::a.b.c.d (compatible)
    if (g0 === 0x64 && g1 === 0xff9b && g2 + g3 + g4 + g5 === 0) return v4(g6, g7); // NAT64
    if (g0 === 0x2002) return v4(g1, g2); // 6to4
    return false;
}

function isMetadataAddress(address: string): boolean {
    const version = isIP(address.split('%')[0] ?? address);
    if (version === 4) {
        const [a = 0, b = 0, c = 0, d = 0] = address.split('.').map(Number);
        return isMetadataIpv4(a, b, c, d);
    }
    if (version === 6) return isMetadataIpv6(address);
    return false;
}

/** Normalise a URL hostname: lowercase, no IPv6 brackets, no trailing dot. */
function normalizeHostname(hostname: string): string {
    const bare =
        hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    let host = bare.toLowerCase();
    while (host.endsWith('.')) host = host.slice(0, -1);
    return host;
}

/**
 * True when a hostname names a metadata target without any DNS lookup: a metadata host name or
 * an IP literal. Pass `URL.hostname`, which already normalises decimal, octal and hex IPv4.
 */
export function isMetadataHost(hostname: string): boolean {
    const host = normalizeHostname(hostname);
    return METADATA_HOSTNAMES.has(host) || isMetadataAddress(host);
}

/**
 * True when a hostname is a metadata target, or is a name that resolves to one. Resolves at call
 * time and checks every answer. A name that does not resolve is not a metadata target; the
 * request itself will fail.
 */
export async function isMetadataTarget(
    hostname: string,
    resolve: Resolve = resolveAllAddresses
): Promise<boolean> {
    if (isMetadataHost(hostname)) return true;
    const host = normalizeHostname(hostname);
    if (isIP(host) !== 0) return false;
    let addresses: string[];
    try {
        addresses = await resolve(host);
    } catch {
        return false;
    }
    return addresses.some(isMetadataAddress);
}
