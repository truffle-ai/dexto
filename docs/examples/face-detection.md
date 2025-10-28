---
title: "Computer Vision: Face Detection & Annotation"
---

import ExpandableImage from '@site/src/components/ExpandableImage';

# Computer Vision: Face Detection & Annotation Using OpenCV

Detect faces in images and annotate them with bounding boxes using computer vision.

**Task:** `Detect all faces in this image and draw bounding boxes around them.`

```bash
dexto --agent image-editor-agent
```

<ExpandableImage src="https://github.com/user-attachments/assets/7e4b2043-c39a-47c7-a403-a9665ee762ce" alt="Face Detection Demo" title="Computer Vision: Face Detection & Annotation" width={900} />

## What it does

The Image Editor Agent includes computer vision capabilities powered by OpenCV:
- Detect faces in uploaded images
- Draw bounding boxes with customizable colors
- Apply filters and transformations
- Save annotated results

## Requirements

- OpenAI GPT-5 Mini (or compatible model)
- Image upload capability (Web UI or API)

## Try it

```bash
# Install the agent
dexto install image-editor-agent

# Run it
dexto --agent image-editor-agent
```

Upload an image in the Web UI, then ask:
```
"Detect all faces in this image and draw bounding boxes around them"
```
