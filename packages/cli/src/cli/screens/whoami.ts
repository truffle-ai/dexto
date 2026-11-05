/**
 * The Signal `dexto whoami` (screen 5): who commands act as, one labelled row each. Behind
 * DEXTO_PALETTE=signal; the JSON result is the same either way.
 */
import { line, link, span, strong, type Span } from '@dexto/tui/signal-text';
import type { dextoAccounts } from '@dexto/agent-management';

type OAuthLogin = dextoAccounts.OAuthLogin;

const LABEL_CELLS = 10;

function row(label: string, value: readonly Span[]): string {
    return line([span('dim', `  ${label.padEnd(LABEL_CELLS)}`), ...value]);
}

export function whoamiLines(profile: string, saved: OAuthLogin): string[] {
    const as = saved.signedInAs;
    return [
        line(
            as === null
                ? [span('cloud', '◆ '), strong('cloud', 'Signed in')]
                : [
                      span('cloud', '◆ '),
                      strong('cloud', `Signed in as ${as.account.name}`),
                      span('fg', `  ${as.account.email}`),
                  ]
        ),
        row('org', [
            span(
                'fg',
                as === null ? 'unknown' : `${as.organization.name} (${as.organization.slug})`
            ),
        ]),
        row('project', [
            saved.cloudProject === null
                ? span('amber', "none: Dexto models can't bill")
                : span('fg', saved.cloudProject.name),
        ]),
        // No plain words for scopes yet, so they show as they are.
        row('access', [span('dim', saved.scopes.join(' '))]),
        row('profile', [span('fg', profile)]),
        row('app', [link(saved.appUrl)]),
        '',
        line([
            span('dim', '  switch: '),
            span('teal', 'dexto login --profile <name>'),
            span('dim', ' · sign out: '),
            span('teal', 'dexto logout'),
        ]),
    ];
}

/** Signed out: local still works. Printed in place of a fault; the exit code is the same. */
export function signedOutLines(): string[] {
    return [
        line([span('teal', '◇ '), span('dim', 'Not signed in · local works fully without it')]),
        line([span('dim', '  sign in: '), span('teal', 'dexto login')]),
    ];
}
