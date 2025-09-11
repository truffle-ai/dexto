# Dexto - Product Specification

## 1. Introduction

Dexto is a highly customizable and flexible AI Agent built in TypeScript. It enables developers and users to create, configure, run, and deploy specialized AI agents (Dextos) for various tasks. Dexto aims to be configuration-driven, allowing extensive customization without deep coding, while still offering the flexibility for developers to extend its core capabilities.

## 2. Goals & Vision

*   **Customization First:** Provide a powerful configuration system (`config.yml`) as the primary means of defining an agent's behavior, tools, memory, and integrations.
*   **Accessibility:** Offer both a Command Line Interface (CLI) for developers and power users, and a Web User Interface (UI) for easier interaction and configuration management.
*   **Extensibility:** Design Dexto with modularity in mind, allowing developers to fork the codebase and integrate custom components or logic.
*   **Portability & Deployment:** Enable users to package their configured Dexto agents using Docker and deploy them locally or to cloud environments like Truffle Cloud.
*   **Default-Driven:** Ensure all configuration options have sensible defaults, allowing users to start with minimal setup.
*   **Ecosystem:** Foster a community around Dexto, encouraging contributions and the sharing of agent templates and configurations.

## 3. Target Audience

*   **Developers:** Building custom AI agents, integrating AI into applications, experimenting with agent capabilities.
*   **Power Users:** Configuring pre-built or custom agents for specific tasks without writing code.
*   **Teams/Organizations:** Deploying and managing specialized AI agents for internal or external use cases (via Truffle Cloud or self hosting).

## 4. Key Features

### 4.1 Core Agent Functionality

*   **CLI Interface:** `dexto` command for running agents, managing configurations, and interacting with the agent directly in the terminal.
*   **Web UI:** `dexto --mode web` gives a web-based interface providing:
    *   Chat interaction with the agent.
    *   Tabs for managing and monitoring different aspects:
        *   MCP Servers (connecting/disconnecting)
        *   Tools Configuration
        *   LLM Settings
        *   System Prompt Customization
        *   Memory Provider Configuration
        *   Observability/Logging
    *   Ability to modify the agent's configuration (`config.yml`) through the UI.
    *   Functionality to save the current configuration as a named template (`~/.dexto/<template_name>.yml`).
*   **MCP Integration:** Built-in support for connecting to and utilizing both local and remote MCP servers for extending agent capabilities.
*   **Memory:** Configurable memory system (default: enabled) allowing agents to retain context across interactions. Support for different memory providers.
*   **Message Management:** Configurable strategies for message handling, including compression and tokenization options.
*   **Tool Confirmation:** Optional step for users to confirm potentially impactful tool actions before execution.
*   **Agent-to-Agent (A2A) Communication:** (Future Consideration) Define settings for enabling communication between Dexto agents.

### 4.2 Configuration (`config.yml`)

*   **Centralized Configuration:** A primary YAML file (`~/.dexto/config.yml` or specified path) defines the agent's entire setup.
*   **Modular Sections:** Configuration organized into distinct sections (e.g., `mcp`, `model`, `memory`, `scheduling`, `tool_confirmation`, `messages`, `a2a`).
*   **Required vs. Optional Settings:** Core settings (like LLM) are required, while others are optional with intelligent defaults.
*   **Environment Variable Support:** Ability to reference environment variables within the config file.
*   **Validation:** Implement validation logic for each configuration section to ensure correctness.
*   **Configuration Management:**
    *   CLI command (`dexto create-config`) to initialize a new config file, potentially from a template.
    *   CLI command (`dexto add-config-section` - Proposed) to assist developers in adding new configuration blocks.
    *   More CLI commands for any repeated touch points to assist developers
*   **Versioning:** The schema defined for the config file will represent a version of dexto. Each time we change it we will bump up Dexto's version. Version = config + features + default values.
    * This is a good way for the truffle-cloud to also know what the supported schema is for each version

### 4.3 Agent Templates

*   **Pre-defined Examples:** Provide several pre-built template configurations (`configuration/templates`) showcasing different agent setups (e.g., Gaming Agent, Shopping Agent).
*   **CLI Initialization:** Command (`dexto create-config --template <template_name>`) to create a new configuration based on a template.
*   **User-Created Templates:** Ability for users to save their custom configurations as templates via the CLI or Web UI. [Premium feature/Cloud feature could allow users to upload their templates onto the cloud]

### 4.4 Docker & Deployment

*   **Dockerization:** Provide tools/commands to package a configured Dexto agent into a Docker image.
*   **Portability:** Saved Docker images allow users to run their specific Dexto configuration anywhere Docker is supported.

## 5. User Experience & Interface

### 5.1 CLI Workflow
This will be the primary hook for developers. Devs like CLI tools to play with.
We can expect that a lot of developers will initially start off with CLI + directly modifying the config
We can think of web ui as a customization/development playground, and the CLI allows us to hook in purists,

### 5.2 Web UI Design
Web UI will be an interactive interface with many buttons and tabs for talking to and customizing Dexto. 
This would allow the user to dynamically customize Dexto while also being able to chat with Dexto. We can also have buttons for saving(docker)/deploying(truffle-cloud) etc. 
Tech details - Each button connects to an API then API connects to a function from LLMService/ContextManager/etc. we can see how to deal with that part and make our codebase more extensible.

This dynamic customization will copy the loaded config file and directly update a copy of the original starting file, called ~/.dexto/current.yml. if user saves the file, it stores it as a template somewhere

This functionality of saving a template should ALSO be a CLI command like `dexto save-config` or something. we can have many different CLI commands for the different things a developer would want (saving a config, loading a config, running CLI, running web UI, dockerizing, deploying to truffle-cloud, etc.)

*   **Main Layout:** Tabbed interface for different configuration/monitoring aspects.
*   **Chat Tab:** Primary interaction area with the agent.
*   **Configuration Tabs:** Dedicated areas for managing MCP servers, tools, LLM, system prompt, memory, etc. Changes dynamically update a *copy* of the originally loaded configuration.
*   **Persistence:** Ability to save the current UI-driven configuration changes back to a file (`.yml`) or as a named template.
*   **Agent Loading:** (Future Consideration) Ability to "load" different saved Dexto configurations/images from the UI.

## 6. Truffle Cloud Integration (Future Vision)

*   **Deployment Target:** Allow users to deploy their saved Dexto Docker images to Truffle Cloud.
*   **Cloud Validation:** Implement checks on Truffle Cloud to validate agent configuration/schema against the right version before deployment.
*   **Premium Features:** Offer enhanced capabilities for cloud-hosted agents:
    *   [For devs] Managed Observability & Tracing - useful for developers to debug things
    *   [For leadership] Usage Analytics (stats, conversation categorization, user satisfaction? idk)
    *   Managed Multi-Agent Systems (connecting cloud agents via A2A - users can connect to their own agents or )
    *   Multi-Tenancy (allowing different users/applications to interact with the same deployed agent instance via distinct user IDs).
    *   Publishing the agents
    *   Exposed APIs for integration into websites/applications.
*   **Hosting Models:** Support different hosting options (e.g., serverless functions, long-running instances) with potentially different storage/application configurations.

## 7. Key Design Tenets

*   **Config First:** Prioritize configuration files for defining agent behavior. Any new feature should have a corresponding config entry for users to customize.
*   **Always Have Defaults:** Ensure optional settings have sensible defaults for ease of use.
*   **Modularity:** Build components (LLM service, memory, tools) to be replaceable or extensible.
*   **Static/Dynamic settings:** Some config settings should be dynamic and have functions to update them. These could be exposed via API as well

## 8. Open Questions & Future Considerations

*   Finalize the A2A communication mechanism and configuration.
*   Define the exact schema and validation process for Truffle Cloud deployments.
*   Specify the exact Docker commands/process for saving agents.
*   Refine the Web UI design for loading/saving/managing multiple agent configurations ("saving different Dextos").
*   Detail the "scheduling" configuration section.
*   Formalize contribution guidelines (`CONTRIBUTING.md`) and developer guide (`DEVELOPER_GUIDE.md`).
*   Consider internal codebase naming conventions ("make it more quirky and Dexto like" - create your dexto, deploy your dexto, run dexto. use dexto as almost a replacement for the word agent).
*   Define the precise APIs exposed by open-source and Truffle Cloud hosted agents.