---
name: ultra3-deep-project-replan
description: Leverages Gemini 3 Deep Think to perform complex risk assessment, replanning, and debugging for Ashbi Design projects.
kind: sop
---

# Ultra3 Deep Project Replan

## Overview
Uses the Gemini 3 Deep Think model's advanced reasoning capabilities to analyze project health, replan critical paths, and resolve complex architectural blockers in the Ashbi Design Hub.

## Parameters
- **project_id** (required): The ID or Name of the project to replan.
- **focus_area** (optional): Specific area to focus on (e.g., "architecture", "blockers", "timeline").

## Steps

### 1. Data Ingestion
**Constraints:**
- You MUST read the current project status, via `src/ai/prompts/replanProject.js`, database exports, or hub endpoints.
- You MUST gather active threads, recent messages, and current health score.

### 2. Deep Think Analysis
**Constraints:**
- You MUST construct a deeply analytical prompt that explicitly requests risk modeling and critical path analysis.
- You MUST request a structured JSON output reflecting the updated project plan.
- You MUST explicitly invoke deep reasoning for resolving architectural or workflow blockers.

### 3. Plan Output
**Constraints:**
- You MUST present the updated plan in markdown format.
- You MUST outline IMMEDIATE tasks, AT_RISK warnings, and mitigation strategies clearly to the user.
- You MUST offer to update the project data in the system.