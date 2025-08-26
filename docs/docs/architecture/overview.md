# Overview

Dexto was built by the Truffle AI team.

We were trying to build useful AI agents in different domains, but we realized that we were re-building a lot of the same plumbing work each time. So we tried to use some existing AI agent frameworks.

Then we felt that we were getting stuck learning frameworks - each framework had different abstractions and levels of control, and we felt there had to be a simpler way to build AI agents.

So we built Dexto with the following tenets:
1. <ins>**Complete configurability**</ins>: We want users to be able to configure every part of Dexto with just a config file.
2. <ins>**MCP first**</ins>: Adopting MCP enables Dexto to interact with tooling in a standardized manner
3. <ins>**Powerful CLI**</ins>: We wanted a powerful CLI we could use for anything AI - just talking to LLMs, creating AI agents, deploying agents, testing out models/prompts/tools
4. <ins>**Re-usable Core primitives**</ins>: We want developers to be able to build all kinds of AI powered interfaces and applications using Dexto, without having to dive-deep into the code, but always having the option to. This allows us to re-use the same core layer to expose AI agents on telegram, discord, slack, etc.
5. <ins>**Simple deployments**</ins>: We want users to be able to play around with different config files of Dexto and simply save the configuration they liked to be able to re-use it anywhere. Docker helps make this happen.


Check out our generated deepwiki [here](https://deepwiki.truffle.ai/dexto) for more details.