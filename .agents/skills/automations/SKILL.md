---
name: "automations"
description: "Create and manage automations using the scheduler tools with suggestive defaults."
toolkits: ["scheduler-tools"]
allowed-tools: ["create_schedule", "update_schedule", "list_schedules", "get_schedule", "get_schedule_history", "trigger_schedule_now", "delete_schedule"]
---

# Automations

## Purpose
Create, update, list, and manage scheduled automations using the scheduler tools with suggestive defaults and minimal back-and-forth.

## Inputs
- User intent (what should happen)
- Timing preference (e.g., “every 10 minutes”, “weekdays at 9am”)
- Optional: timezone, enable/disable, immediate run

## Steps
1. Infer a sensible default schedule from the user’s request and keep the canonical cron internal (do not display it).
2. Propose a compact, human-friendly configuration (name, cadence, enabled, instruction). Inherit the default session mode unless the user specifies one.
3. Create the automation with `create_schedule` after confirmation.
4. If the user asks to edit an existing automation, use `update_schedule` with only the changed fields.
5. For review or troubleshooting, use:
   - `list_schedules` to show available schedules
   - `get_schedule` to retrieve a schedule by id
   - `get_schedule_history` to show recent runs
6. If the user wants to run immediately, call `trigger_schedule_now` with the schedule id.
7. If the user wants to remove it, call `delete_schedule` with the schedule id.

## Output Format
- Confirm action taken (created/updated/triggered/deleted).
- Provide the schedule id and key fields (name, cadence, enabled).
- If listing, show a compact table of schedules (id, name, cadence, next run, enabled).