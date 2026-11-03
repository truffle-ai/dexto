/** What kind of thing went wrong; each kind has an exit code an agent can branch on. */
export type FailureKind =
    | 'failed'
    | 'invalid_input'
    | 'needs_confirmation'
    | 'needs_permission'
    | 'needs_sign_in'
    | 'not_found'
    | 'waiting_on_person';

export const EXIT_CODES = {
    failed: 1,
    invalid_input: 2,
    needs_confirmation: 4,
    needs_permission: 3,
    needs_sign_in: 3,
    not_found: 5,
    waiting_on_person: 6,
    usage: 2,
} as const satisfies Record<FailureKind | 'usage', number>;

/** What each exit code means; frozen in 2.0 and shown in help. */
export const EXIT_CODE_MEANINGS = {
    '0': 'done',
    '1': 'failed',
    '2': 'usage or invalid input',
    '3': 'needs sign-in or permission',
    '4': 'needs confirmation: pass --yes once your person has agreed',
    '5': 'not found',
    '6': 'waiting on a person, such as an approval',
} as const;

/** A failure that says what kind it is and, where there is one, the command that fixes it. */
export class CommandFailure extends Error {
    readonly fix: string | null;
    readonly kind: FailureKind;

    constructor(kind: FailureKind, message: string, fix: string | null) {
        super(message);
        this.name = 'CommandFailure';
        this.fix = fix;
        this.kind = kind;
    }
}
