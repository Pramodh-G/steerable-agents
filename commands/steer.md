---
description: Switch steering mode (autopilot, copilot, pair), or show the current one
argument-hint: "[autopilot|copilot|pair]"
allowed-tools: Bash(python3:*)
disable-model-invocation: true
---

!`python3 "${CLAUDE_PLUGIN_ROOT}/hooks/steer.py" $ARGUMENTS`
