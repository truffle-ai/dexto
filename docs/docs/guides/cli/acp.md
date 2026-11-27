---
sidebar_position: 5
title: 'Use Dexto in ACP editors'
---

# Use Dexto in ACP editors

`dexto acp` runs Dexto's agent for an editor or coding app that speaks the [Agent Client Protocol](https://agentclientprotocol.com) (ACP), such as T3 Code or Zed. The app starts `dexto acp` and talks to it over stdin and stdout. You chat in the app, and Dexto works with your files, tools and models as it does in the terminal.

:::note Preview
`dexto acp` is in preview. Its behaviour over ACP may change between releases.
:::

## Set it up

Install the Dexto CLI and sign in:

```bash
npm install -g dexto
dexto login
```

Then add Dexto to your app as a local ACP agent with the command `dexto` and the argument `acp`.

- **T3 Code:** choose **Add provider → Local ACP command**, then enter `dexto` as the command and `acp` as the argument.
- **Zed and other ACP apps:** add a custom agent server that runs `dexto acp`. Your app's documentation shows where its agent servers are configured.

Each session works in the folder the app opens, and Dexto reads that project's instructions, prompts and skills. One `dexto acp` process serves one project. For another project, the app needs another `dexto acp` process.

To use a particular agent or model, add them to the arguments:

```bash
dexto --agent ./my-agent.yml acp
dexto acp --model gpt-5
```

Without `--model`, sessions start on your default model (the one you set as default in the terminal's `/model` picker, or during setup), even when `--agent` names a config.

## Models and reasoning

The app's model picker lists:

- the session's current model;
- your favorite and recent models from the Dexto CLI;
- the models your Dexto account offers, when you are signed in.

When the model can reason, the app also shows its reasoning effort, such as low, medium or high.

If a model needs a key you haven't set, the app tells you which one, for example `Set ANTHROPIC_API_KEY to use anthropic models`. Dexto models need a sign-in that may spend credits: run `dexto login --scope cloud:write`. Apps that can open a terminal for sign-in also offer **Sign in to Dexto**, which runs it for you. A missing provider key comes back as a plain error, not a sign-in request, since signing in can't supply it.

## Modes

Sessions offer the same four modes as the terminal's Shift+Tab:

| Mode         | What it does                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Asks you     | Asks before file edits, commands and other actions that need approval.                                                     |
| Plan         | Plans before changing anything, and asks you to approve the plan. After you approve it, the session goes back to Asks you. |
| Accept edits | Edits files inside the project without asking, and asks for everything else.                                               |
| Full access  | Runs tools and commands without asking.                                                                                    |

A session starts in the agent's `permissions.mode`. Tools that must always ask still ask in every mode. If the agent is configured with `permissions.mode: full-access`, Full access is the only mode.

## Permissions and questions

When Dexto needs approval, the app asks you to **Allow**, **Allow for this session** or **Reject**. When Dexto asks you a question, for example with the `ask_user` tool, the app shows it as a form if it supports forms. A request you don't answer within `permissions.timeout` (or `elicitation.timeout` for forms) is withdrawn, and the tool doesn't run.

## Slash commands

Your prompts and skills appear in the app's `/` menu. Type `/name`, then any `key=value` arguments and extra context, as in the terminal:

```text
/review lang=ts focus on error handling
```

## Sessions

The app can list your project's Dexto sessions, reopen one with its earlier messages, or resume it without replaying them. Sessions are titled after their first prompt. After each turn the app shows how much of the model's context the session uses, and its cost so far when Dexto knows it.

## Limits

- Images and audio in prompts aren't supported yet. Text and attached file contents are.
- The MCP servers configured in your app aren't used. Dexto uses its agent's own MCP servers.
- Logs go to stderr. Stdout carries only ACP messages.
