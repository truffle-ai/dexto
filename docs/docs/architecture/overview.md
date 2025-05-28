# Overview

Saiki was built by the Truffle AI team.

We were trying to build useful AI agents in different domains, but we realized that we were re-building a lot of the same plumbing work each time. So we tried to use some existing AI agent frameworks.

Then we felt that we were getting stuck learning frameworks - each framework had different abstractions and levels of control, and we felt there had to be a simpler way to build AI agents.

So we built Saiki with the following tenets:
1. Complete configurability: We want users to be able to configure every part of Saiki with just a config file.
2. Code-level overrides: We understand that sometimes just a config file isn't sufficient for very custom use-cases, so we allow overriding parts of Saiki through the code.
3. Separate application layer and core agent layer: We want developers to be able to build all kinds of AI powered interfaces and applications on top of Saiki without having to dive-deep into the code, but always having the option to. This allows us to re-use the same core layer to expose AI agents on telegram, discord, slack, etc.
4. Simple deployments: We want users to be able to play around with different config files of Saiki and simply save the configuration they liked to be able to re-use it anywhere. Docker helps make this happen.
5. MCP first: Adopting MCP enables Saiki to interact with tooling in a standardized manner
6. Powerful CLI: We wanted a really good CLI we could use for anything - just talking to LLMs, creating AI agents, deploying agents

More on this coming soon!