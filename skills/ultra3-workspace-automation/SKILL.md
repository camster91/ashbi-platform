---
name: ultra3-workspace-automation
description: Automates generation of client proposals, invoices, and reports across Google Workspace using Ultra3 storage and Gemini integrations.
kind: sop
---

# Ultra3 Workspace Automation

## Overview
Generates client-facing documents (Docs, Sheets, Invoices) utilizing the Ashbi Design backend data and Google Workspace integrations available in the Ultra3 plan.

## Parameters
- **document_type** (required): Type of document ("proposal", "invoice", "report").
- **client_id** (required): Target client ID or Name.
- **data_source** (optional): Specific data or context to include in the document.

## Steps

### 1. Data Compilation
**Constraints:**
- You MUST fetch relevant data from the Ashbi Design hub (e.g., `src/services/stripe.service.js` for invoices, or project files for reports).
- You MUST review past interactions or active threads if necessary to provide context.

### 2. Document Generation
**Constraints:**
- You MUST use the AI to draft the full markdown, JSON, or HTML representation of the document.
- You MUST ensure the tone aligns with Ashbi Design's professional standards.

### 3. Workspace Integration
**Constraints:**
- You MUST outline the next steps for pushing this data to Google Workspace (using the user's available APIs, Zapier/Make, or manual handoff if direct API integration is pending).
- You MUST confirm the document generation is complete and present the draft for approval.