---
name: ultra3-cinematic-design
description: Automates high-fidelity cinematic video generation specs and OpenPencil design assets using Veo 3.16 and Flow features.
kind: sop
---

# Ultra3 Cinematic & Design Automation

## Overview
Utilizes the high-tier limits of Google AI Ultra3 to generate cinematic video scenes (via Veo 3.16/Flow) and visual assets (via OpenPencil) for Ashbi Design clients.

## Parameters
- **client_name** (required): The Ashbi Design client receiving the design/video.
- **asset_type** (required): "video" or "ui_ux".
- **description** (required): Creative brief for the generation.
- **openpencil_path** (optional): Path to `.fig` or `.pen` file if `asset_type` is "ui_ux".

## Steps

### 1. Requirements Gathering
**Constraints:**
- You MUST verify the `asset_type`.
- If `video`, you MUST prompt the user for the cinematic mood, lighting, and duration.
- If `ui_ux`, you MUST verify the `openpencil_path` or create a new one.

### 2. Prompt Construction
**Constraints:**
- You MUST craft a detailed prompt for Veo 3.16/Flow ensuring high cinematic quality.
- For OpenPencil, you MUST use the `coding_task` or `bash` tools with `@open-pencil/cli` to manipulate or create the design.

### 3. Execution
**Constraints:**
- You MUST output the final generated prompt, design specification, or execute the OpenPencil commands directly.
- You MUST confirm completion with the user and offer revisions.