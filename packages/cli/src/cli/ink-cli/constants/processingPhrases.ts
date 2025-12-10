/**
 * Processing phrases for the status bar
 * These cycle during processing to provide entertaining feedback
 */

export const processingPhrases: string[] = [
    // Thinking/Processing
    'Thinking...',
    'Processing...',
    'Pondering...',
    'Contemplating...',
    'Analyzing...',
    'Computing...',
    'Cogitating...',
    'Deliberating...',
    'Ruminating...',
    'Mulling it over...',

    // Creative/Fun
    'Consulting the oracle...',
    'Asking the magic 8-ball...',
    'Reading the tea leaves...',
    'Channeling the wisdom...',
    'Summoning intelligence...',
    'Brewing ideas...',
    'Crafting response...',
    'Weaving thoughts...',
    'Connecting neurons...',
    'Firing synapses...',

    // Tech-themed
    'Crunching numbers...',
    'Parsing possibilities...',
    'Compiling thoughts...',
    'Optimizing response...',
    'Running inference...',
    'Querying knowledge base...',
    'Searching solution space...',
    'Traversing decision tree...',
    'Evaluating options...',
    'Processing tokens...',

    // Playful
    'One moment please...',
    'Bear with me...',
    'Almost there...',
    'Working on it...',
    'Hang tight...',
    'Give me a sec...',
    'Let me think...',
    'Hmm, interesting...',
    'Good question...',
    'On it...',

    // Dramatic
    'Diving deep...',
    'Exploring possibilities...',
    'Venturing forth...',
    'Seeking answers...',
    'Unraveling mysteries...',
    'Decoding request...',
    'Assembling response...',
    'Formulating reply...',
    'Generating wisdom...',
    'Crafting magic...',

    // Nerdy
    'Consulting the docs...',
    'Checking Stack Overflow...',
    'Reading the source...',
    'Grepping for answers...',
    'Running the algorithm...',
    'Executing plan...',
    'Loading context...',
    'Warming up GPUs...',
    'Attention is all I need...',
    'Transformer powers activate...',

    // Casual
    "Let's see here...",
    'Alright, working on it...',
    'Just a moment...',
    'Coming right up...',
    'Getting there...',
    'Making progress...',
    'Stay tuned...',
    'Loading...',
    'Please wait...',
    'In progress...',
];

/**
 * Get a random phrase from the list
 */
export function getRandomPhrase(): string {
    const index = Math.floor(Math.random() * processingPhrases.length);
    return processingPhrases[index] ?? 'Processing...';
}
