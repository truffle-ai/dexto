import { describe, expect, it } from 'vitest';
import { webhookUrlProblem } from '../webhook-url.js';

describe('webhookUrlProblem', () => {
    it.each(['https://example.com/hook', 'http://localhost:8080/hook', 'http://192.168.1.20/hook'])(
        'accepts %s',
        (url) => {
            expect(webhookUrlProblem(url)).toBeUndefined();
        }
    );

    it.each([
        'ftp://example.com/hook',
        'file:///etc/hosts',
        'https://user:pass@example.com/hook',
        'http://169.254.169.254/latest',
        'http://metadata.google.internal/',
        'http://metadata.google.internal./',
        'http://[::ffff:169.254.169.254]/',
        'http://[::ffff:a9fe:a9fe]/',
        'http://169.254.169.254./',
        'http://2852039166/',
        'http://[fe80::1]/',
        'http://[fd00:ec2::254]/',
        'http://100.100.100.200/',
        'not a url',
    ])('rejects %s', (url) => {
        expect(webhookUrlProblem(url)).toBeDefined();
    });
});
