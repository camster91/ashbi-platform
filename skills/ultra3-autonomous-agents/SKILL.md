---
name: ultra3-autonomous-agents
description: Scales and manages background Gemini Agents for outreach and client communication using high rate limits.
kind: sop
---

# Ultra3 Autonomous Agents

## Overview
Deploys and monitors autonomous outreach agents (Upwork, LinkedIn, SEO, Sales) leveraging the highest rate limits provided by the Google AI Ultra3 plan for Ashbi Design.

## Parameters
- **agent_type** (required): Type of agent to scale (e.g., "upwork", "linkedin", "seo", "sales").
- **target_volume** (required): Desired volume of outreach or actions per day.
- **campaign_context** (optional): Context or messaging guidelines for the agent.

## Steps

### 1. Configuration Review
**Constraints:**
- You MUST review the corresponding agent script in `/home/camst/Ashbi-Design/agents/` or `/home/camst/Ashbi-Design/upwork-agent/`.
- You MUST verify that the agent is using the `gemini` provider and is configured to utilize the maximum allowed tokens/limits.

### 2. Agent Deployment
**Constraints:**
- You MUST use `rho_subagent` or `agent-start` tools to run the agent in the background.
- You MUST provide the `campaign_context` to the agent initialization.
- You MUST verify the agent starts successfully without immediate errors.

### 3. Monitoring & Reporting
**Constraints:**
- You MUST output the tmux session or agent ID for the user to monitor.
- You MUST set up a reminder (via `brain` tool) to check on the agent's status after an appropriate interval.
- You MUST report any immediate rate-limit or connection errors to the user.