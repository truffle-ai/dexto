import { isIP } from 'node:net';

/**
 * Addresses that a tool or model-driven fetch must not connect to: loopback, private, link-local,
 * shared, documentation, multicast and reserved ranges, and IPv6 forms that carry such an IPv4
 * address (mapped, compatible, 6to4, NAT64).
 *
 * This is the one place that decides what "private" means. Cloud metadata services are a subset
 * of it (link-local, 169.254.0.0/16 and fe80::/10); a metadata-host check can be layered on top
 * for host names that this address check cannot see.
 */

function isPrivateIpv4Octets(a: number, b: number, c: number): boolean {
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // multicast and reserved
    return false;
}

function isPrivateIpv4(ip: string): boolean {
    const [a, b, c, d, ...rest] = ip.split('.').map((part) => Number(part));
    if (a === undefined || b === undefined || c === undefined || d === undefined) return false;
    if (rest.length > 0 || [a, b, c, d].some((part) => Number.isNaN(part))) return false;
    return isPrivateIpv4Octets(a, b, c);
}

/** The IPv4 address held in two 16-bit IPv6 groups. */
function isPrivateEmbeddedIpv4(high: number, low: number): boolean {
    return isPrivateIpv4Octets(high >> 8, high & 255, low >> 8);
}

/** The eight 16-bit groups of an IPv6 address. The URL parser first writes it in canonical form. */
function ipv6Groups(ip: string): number[] {
    const canonical = new URL(`http://[${ip.split('%')[0]}]/`).hostname.slice(1, -1);
    const [head = '', tail] = canonical.split('::');
    const headGroups = head === '' ? [] : head.split(':');
    const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':');
    const missing = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
    return [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups].map((group) =>
        Number.parseInt(group, 16)
    );
}

function isPrivateIpv6(ip: string): boolean {
    const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = ipv6Groups(ip);
    const upperZero = g0 + g1 + g2 + g3 === 0;

    if (upperZero && g4 + g5 + g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: and ::1
    if (upperZero && g4 === 0 && g5 === 0xffff) return isPrivateEmbeddedIpv4(g6, g7); // mapped
    if (upperZero && g4 === 0xffff && g5 === 0) return isPrivateEmbeddedIpv4(g6, g7); // translated
    if (upperZero && g4 === 0 && g5 === 0) return isPrivateEmbeddedIpv4(g6, g7); // compatible
    if (g0 === 0x64 && g1 === 0xff9b) {
        // NAT64: 64:ff9b::/96 maps IPv4 addresses (the translator reaches private ones), and
        // 64:ff9b:1::/48 is local-use.
        if (g2 + g3 + g4 + g5 === 0 || g2 === 1) return true;
    }
    if (g0 === 0x2002) return isPrivateEmbeddedIpv4(g1, g2); // 6to4
    if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated, still routed)
    if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
}

/** Check an IP literal or a DNS answer. IPv6 literals may carry the URL brackets. */
export function isPrivateAddress(ip: string): boolean {
    const address = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
    const version = isIP(address.split('%')[0] ?? address);
    if (version === 4) return isPrivateIpv4(address);
    if (version === 6) return isPrivateIpv6(address);
    return false;
}
