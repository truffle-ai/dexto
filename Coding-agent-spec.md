thlAgent:
    Role:
    Knowledge:
    MCP Servers:
    Memory - could be as an MCP server

Agents needed to automate PR generation:
     
  1. Planner/PRD agent - 
    Role: 
        Responsible for creating the product requirements document based on the new features needed by the team. Has comprehensive discussions with user to plan out the feature and ensure the team is happy with the spec
    Servers:
      github MCP - specifically to read PRs, Github issues, commit history
      filesystem MCP - for navigating files on the system
      PRD generator MCP? - this doesn't exist but could help standardizing the PRD generation
    Knowledge:
      codebase knowledge
      knowledge of previous tasks/PRs
      knowledge of current github issues
    Memory:
      history of project work this agent has done before

  2. Technical document agent:
    Role: 
        Responsible for creating a technical requirements document based on the PRD and user discussion
    Servers:
        Technical document MCP? - something to create a technical document with a defined specification/format
        filesystem MCP
        Linear/Asana MCP? - for task updation/tracking
    Knowledge:
        codebase knowledge
        knowledge of previous tasks/PRs
        knowledge of current github issues 
    History:
        History of previous tasks done before

    
  3. Task-creation agent:
    Role:
        Reads the PRD and technical requirements documents and generates the task-list
    Servers:
        Task-master MCP - for generating the tasklist
    Knowledge:
        same as prev
    Memory:
        same as prev

  4. Coder agent
    Role:
        Responsible for generating and testing the code repeatedly until it completes all the tasks defined in the task list, and pushing the code to a github PR.
    Servers:
        task-master MCP - task mgmt
        codex MCP - can be the backbone of the actual coding?
        filesystem/desktopCommander MCP
        github MCP 
    Knowledge:
        same as above +
        knowledge of coding styles + scripts in the codebase + best practices
    Memory:
        memory of previous coding sessions done
        ideally access to talk to review agent as well to remember mistakes it made
    Extra:
        BANGER system prompt 

  5. Review agent 
    Role: Responsible for reviewing the PR and adding comments on the PR.
    Servers:
      task-master MCP
      codex MCP
      filesystem/desktopCommander MCP
      github MCP - read permissions to see latest PRs and have comment permissions on latest PRs
      extract diff MCP - extract git diff from main into separate files based on diff
      Additional servers to help specifically with analyzing PRs
    Knowledge:
        (codebase knowledge) + 
        important things to keep in mind while reviewing/best practices - can be based on the package as well
    Memory:
        Previous sessions it has with the Coding agent
    Additional:
        Could even be triggered as part of a github workflow which reaches out to the coding agent?
    

Agents 4 and 5 need to keep talking in a loop until they reach consensus. 
They should ideally also have knowledge of their previous conversations
