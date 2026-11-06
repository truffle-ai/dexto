import { line, span, strong } from '@dexto/tui/signal-text';

/** Signal uses cloud blue for the computer and teal for this machine. */
export function chatMoveScreen(id: string, location: 'cloud' | 'local'): string {
    const tone = location === 'cloud' ? 'cloud' : 'teal';
    return [
        line([
            span(tone, location === 'cloud' ? '◆ ' : '◇ '),
            strong(tone, location === 'cloud' ? 'Cloud computer' : 'This machine'),
            span('dim', ` · ${id}`),
        ]),
        location === 'cloud'
            ? line([
                  span('dim', '  attach: '),
                  span('cloud', `dexto chat watch ${id}`),
                  span('dim', ' · Ctrl-C detaches'),
              ])
            : line([span('dim', '  resume: '), span('teal', `dexto -r ${id}`)]),
        location === 'cloud'
            ? line([span('dim', '  return: '), span('teal', `dexto chat move ${id} --to local`)])
            : line([span('dim', '  backup: git stash list · dexto hand-off backup')]),
    ].join('\n');
}
