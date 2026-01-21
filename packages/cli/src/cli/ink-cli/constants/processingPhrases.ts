/**
 * Processing phrases for the status bar
 * These cycle during processing to provide entertaining feedback
 */

export const processingPhrases: string[] = [
    // pop culture
    'I want to be the very best…',
    'I will be the next hokage…',
    'Shinzou Sasageyo…',
    'My soldiers! Rage!…',
    'May the force be with you…',
    'Why so serious?…',
    "That's what she said …",
    'Winter is coming…',
    "It's over 9000!…",
    "I'm Batman…",
    "You can't handle the truth…",
    'We were on a break!…',
    'Bazinga!…',
    "How you doin'?…",
    "There's always money in the banana stand…",
    'I am the one who knocks…',
    'Yabba dabba doo!…',
    'The tribe has spoken…',
    'This is the Way…',
    'Plata o plomo…',
    'Yeah, science!…',
    "They're minerals, Marie!…",
    'The North remembers…',
    'Life is like a box of chocolates…',
    'Avengers, assemble!',
    'I can do this all day…',
    'Elementary, my dear Watson…',
    'Identity theft is not a joke, Jim! …',
    "I'm not superstitious, but I am a little stitious…",
    'Why waste time say lot word when few word do trick?…',
    "You're a wizard, Harry…",
    "I'll be back…",
    'Houstons, we have a problem…',
    'Are you not entertained?…',
    'To infinity and beyond…',
    'Snakes. Why did it have to be snakes?…',
    'Hakuna matata…',

    // Playful
    'Let me cook…',
    'Manifesting greatness…',
    'Rizzing the huzz…',
    'Memeing…',
    'Outperforming other AI agents…',
    'Rolling with the squad…',
    'Incanting secret scripts…',
    'Making no mistakes…',
    'Making you rich…',
    'Farming easy points…',
    'Using 200+ IQ…',
    'Turning into Jarvis…',
    'Dextomaxxing…',
    'Zapping…',
    'Braining…',
    'Using all 3 brain cells…',
    "I'm not lazy, I'm just on energy-saving mode…",
    'I came. I saw. I made it awkward…',
    'My boss told me to have a good day, so I went home…',
    "I put the 'pro' in procrastination…",
    'Delulu is the solulu…',
    'Zombies eat brains. You are safe…',
    //'Installing malware (just kidding)…',

    // Vines
    'Look at all those chickens…',
    'What are those!!…',
    'He needs some milk…',
    'Something came in the mail today…',
    'Road work ahead? I sure hope it does…',
    'Merry Chrysler…',
    "I'm in me mum's car. Vroom vroom…",
    'Stop! I could have dropped my croissant!…',
    'That was legitness…',
    'Why are you running?…',
    'What da dog doin?…',
    'Can I pet that dawg?…',
    'And they were roommates!…',

    // Nerdy
    'Attention is all I need…',
    'Transformer powers activate…',
];

/**
 * Get a random phrase from the list
 */
export function getRandomPhrase(): string {
    const index = Math.floor(Math.random() * processingPhrases.length);
    return processingPhrases[index] ?? 'Processing…';
}
