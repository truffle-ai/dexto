---
title: "Podcast Agent: Generate AI Podcasts"
---

import ExpandableImage from '@site/src/components/ExpandableImage';

# Podcast Agent: Generate AI Podcasts

Generate engaging podcast content with AI-powered audio generation featuring multiple speakers.

**Task:** `Generate an intro for a podcast about the latest in AI.`

```bash
dexto --agent podcast-agent
```

<ExpandableImage src="https://github.com/user-attachments/assets/cfd59751-3daa-4ccd-97b2-1b2862c96af1" alt="Podcast Agent Demo" title="Podcast Agent Demo" width={900} />

## What it does

The Podcast Agent uses Google Gemini TTS to create multi-speaker audio content:
- Generate podcast intros and outros
- Create conversations between multiple hosts
- Customize voice characteristics and speaking styles
- Export high-quality audio files

## Requirements

- `GOOGLE_GENERATIVE_AI_API_KEY` environment variable
- Google Gemini 2.5 Flash (included in agent config)

## Try it

```bash
# Install the agent
dexto install podcast-agent

# Run it
dexto --agent podcast-agent
```

Try prompts like:
```
"Generate a podcast intro with two hosts discussing the future of AI in healthcare"
```
