import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from './private-address.js';

describe('isPrivateAddress', () => {
    it.each([
        '0.0.0.0',
        '10.1.2.3',
        '127.0.0.1',
        '169.254.169.254',
        '172.16.0.1',
        '192.168.1.1',
        '100.64.0.1',
        '224.0.0.1',
        '255.255.255.255',
    ])('blocks IPv4 %s', (ip) => {
        expect(isPrivateAddress(ip)).toBe(true);
    });

    it.each([
        '::',
        '::1',
        '[::1]',
        '::ffff:127.0.0.1',
        '::ffff:10.0.0.1',
        '::127.0.0.1',
        'fe80::1',
        'febf::1',
        'fc00::1',
        'fd12:3456::1',
        '2002:7f00:1::',
        '64:ff9b:1::a00:1',
    ])('blocks IPv6 %s', (ip) => {
        expect(isPrivateAddress(ip)).toBe(true);
    });

    it.each([
        ['64:ff9b::', 'NAT64 prefix, 0.0.0.0'],
        ['64:ff9b::7f00:1', '127.0.0.1'],
        ['64:ff9b::a9fe:a9fe', '169.254.169.254'],
        ['64:ff9b::a00:1', '10.0.0.1'],
        ['64:ff9b::c0a8:1', '192.168.0.1'],
        ['[64:ff9b::7f00:1]', 'bracketed'],
        ['64:ff9b:1::a00:1', 'local-use 64:ff9b:1::/48'],
    ])('blocks NAT64 %s (%s)', (ip) => {
        expect(isPrivateAddress(ip)).toBe(true);
    });

    it.each([
        ['64:ff9b::808:808', '8.8.8.8'],
        ['64:ff9b::5db8:d822', '93.184.216.34'],
        ['[64:ff9b::808:808]', 'bracketed'],
    ])('allows NAT64 %s, which reaches the public address %s', (ip) => {
        expect(isPrivateAddress(ip)).toBe(false);
    });

    it.each(['fec0::1', 'fec0::', 'fedc:1::1', 'feff:ffff::1'])(
        'blocks site-local fec0::/10 address %s',
        (ip) => {
            expect(isPrivateAddress(ip)).toBe(true);
        }
    );

    it.each(['ff00::', 'ff02::1', 'ff05::1:3', 'ffff::1', 'ff0e::101'])(
        'blocks multicast ff00::/8 address %s',
        (ip) => {
            expect(isPrivateAddress(ip)).toBe(true);
        }
    );

    it.each([
        '93.184.216.34',
        '8.8.8.8',
        '2606:2800:220:1:248:1893:25c8:1946',
        '2001:4860:4860::8888',
        '2002:808:808::',
        '::ffff:8.8.8.8',
        '64:ff9a::1',
        '64:ff9c::1',
        'fe7f::1',
        'fbff::1',
    ])('allows public address %s', (ip) => {
        expect(isPrivateAddress(ip)).toBe(false);
    });

    it('does not treat host names as addresses', () => {
        expect(isPrivateAddress('localhost')).toBe(false);
        expect(isPrivateAddress('example.com')).toBe(false);
    });
});
