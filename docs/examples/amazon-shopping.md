---
title: "Browser Agent: Amazon Shopping Assistant"
---

# Browser Agent: Amazon Shopping Assistant

Automate web browsing tasks like shopping, research, and data collection with AI-powered browser control.

**Task:** `Can you go to amazon and add some snacks to my cart? I like trail mix, cheetos and maybe surprise me with something else?`

```bash
# Default agent has browser tools
dexto
```

<a href="https://youtu.be/C-Z0aVbl4Ik">
  <img src="https://github.com/user-attachments/assets/3f5be5e2-7a55-4093-a071-8c52f1a83ba3" alt="Dexto: Amazon shopping agent demo" width="600"/>
</a>

## What it does

The default Dexto agent includes browser automation tools powered by Puppeteer:
- Navigate websites
- Fill out forms
- Click buttons and links
- Extract information
- Make purchases (with approval)
- Screenshot and analyze pages

## How it works

The agent uses browser tools to:
1. Open websites in a real browser
2. Understand page content
3. Interact with elements (click, type, scroll)
4. Complete multi-step tasks
5. Return results or confirmations

## Use Cases

- **Shopping**: Find and add items to cart
- **Research**: Collect data from multiple sources
- **Form Filling**: Automate repetitive data entry
- **Price Comparison**: Check prices across sites
- **Booking**: Reserve hotels, flights, restaurants
- **Content Extraction**: Scrape information from websites

## Try it

```bash
# Use default agent (includes browser tools)
dexto

# Example prompts
"Find the cheapest wireless mouse on Amazon"
"Book a table at an Italian restaurant nearby for 2 people at 7pm"
"Compare prices for iPhone 15 on Best Buy and Amazon"
```

## Safety Features

- **Approval prompts** before purchases or sensitive actions
- **Session isolation** for security
- **Headless or visible mode** options
- **Screenshot capture** for verification

## Learn More

- [CLI Guide](/docs/guides/cli/overview)
- [Agent Configuration](/docs/guides/configuring-dexto/overview)
- [Tool Approval](/docs/guides/configuring-dexto/agent-yml#tool-approval)
