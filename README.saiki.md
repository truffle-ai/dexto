# Dexto - README Draft

## Introduction
Dexto is a highly customizable, flexible, powerful AI Agent, built in Typescript.

Replicate different versions of Dexto to build specialized AI agents.

### Key Features:

*   **CLI first, web UI supported:** Interact via terminal or a web interface.
*   **In-built MCP support:** Supports both remote and local MCP servers.
*   **Fully customizable:** Update `~/.dexto/config.yml` to customize your agent. Pre-built templates available.
*   **Supports Docker:** Save your Dexto configurations as Docker images to re-run or host anywhere.
*   **Deploy to Truffle Cloud:** Deploy Docker images built with Dexto to Truffle Cloud (coming soon).

### Example Use Cases:

*   **Gaming Agent:** An agent built to play Pokémon Emerald.
*   **Shopping Agent:** Connects to Notion and browsers to manage shopping lists and carts.

## How to Use Dexto:

1.  **Install:**
    ```bash
    npm install -g dexto
    ```
2.  **Start Dexto:**
    *   CLI: `dexto`
    *   Web UI: `dexto --mode web`
3.  **Configure Dexto:**
    *   Create a new config file: `dexto create-config`
    *   Create from a template: `dexto create-config --template <template_name>`
    *   *(These commands guide environment setup)*
    *   Modify the generated `~/.dexto/config.yml` for custom behavior.
    *   Environment variables can be referenced in the config.
4.  **Save with Docker:** (Docker command TBD)
5.  **Deploy to Truffle Cloud:** (Coming soon)

## How to Work with Dexto's Code (Development):

Dexto is fully flexible - you can fork the codebase and customize it for your use cases.

1.  **Setup:**
    ```bash
    git clone <repo_url> && cd dexto
    pnpm install
    pnpm run build && pnpm start
    ```
2.  *(More details in DEVELOPER_GUIDE.md)*

## Contributions

If you've built something cool or want to contribute:

*   Check out `CONTRIBUTING.md` (link TBD).
*   Join our Discord (link TBD).

We welcome contributions! 