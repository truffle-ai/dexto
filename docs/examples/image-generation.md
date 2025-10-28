---
title: "Hugging Face: Image Generation"
---

import ExpandableImage from '@site/src/components/ExpandableImage';

# Hugging Face: Image Generation

Generate images using Hugging Face models with simple text prompts.

**Task:** `Generate a photo of a baby panda.`

```bash
dexto --agent nano-banana-agent 
```

<ExpandableImage src="https://github.com/user-attachments/assets/570cbd3a-6990-43c5-b355-2b549a4ee6b3" alt="Hugging Face Image Generation Demo" title="Hugging Face: Image Generation" width={900} />

## What it does

The Nano Banana Agent uses Google's Gemini 2.5 Flash Image model (formerly Nano Banana) for advanced image operations:
- Generate images from text descriptions
- Edit existing images
- Apply style transformations
- Create variations
- Enhance image quality

## Requirements

- `GOOGLE_GENERATIVE_AI_API_KEY` environment variable
- Google Gemini 2.5 Flash Image model (included in agent config)

## Try it

```bash
# Install the agent
dexto install nano-banana-agent

# Open the agent in web UI
dexto --agent nano-banana-agent
```

Try different Prompts to generate images:
```
"create a futuristic cityscape with flying cars"
"generate a watercolor painting of a sunset over mountains"
"create a cute robot mascot for a tech startup"
```

## Features

- **High Quality**: Generated using state-of-the-art Google Gemini models
- **Fast Generation**: Optimized for quick results
- **Flexible Prompts**: Natural language descriptions
- **Multiple Styles**: From photorealistic to artistic
- **Batch Generation**: Create multiple variations

## Advanced Usage

### Style Control
```
"Generate a baby panda in watercolor style"
"Create a photorealistic portrait of a mountain landscape"
"Generate an anime-style character design"
```

### Specific Details
```
"Generate a photo of a baby panda sitting on a rock, surrounded by bamboo, with soft lighting"
```

### Variations
```
"Generate 3 variations of a modern logo for a coffee shop"
```

## Learn More

- [Nano Banana Agent in Registry](/docs/guides/agent-registry#%EF%B8%8F-nano-banana-agent)
- [Agent Configuration](/docs/guides/configuring-dexto/overview)
- [Google Gemini Models](https://ai.google.dev/)
