# Upwork Agent

Automation agent for syncing Upwork activity into Agency Hub. Supports all 3 Upwork account modes.

## Account Modes

1. **Freelancer** — Ashbi offers services, bids on client jobs
   - `npm run feed` — Scrape best-match job listings, score by keywords, sync as leads
   - `npm run proposals` — Track submitted proposal statuses

2. **Client (Basic)** — Cameron hires freelancers for Ashbi
   - `npm run hiring` — Scrape job posts, applicants, and active contracts

3. **Messages** — Unified inbox across all modes
   - `npm run messages` — Scrape unread messages from all rooms

4. **All** — Run everything in sequence
   - `npm run all`

## Setup

```bash
cd upwork-agent
npm install
cp .env.example .env
# Edit .env — set UPWORK_PROJECT_ID (or create a project named "Upwork" in hub)
```

## Chrome Profile

Uses Chrome Profile 4 (cameron@ashbi.ca). Must be logged into Upwork. Browser opens in headed mode.

## Hub Sync

All data syncs to Agency Hub as tasks via the bot API:
- **Outbound (we sell):** tags `upwork`, `lead`/`proposal`, `outbound`
- **Inbound (we hire):** tags `upwork`, `hiring`/`applicant`/`contract`, `inbound`
- **Messages:** tags `upwork`, `message`

## Tagging

| Mode | Tag combo |
|------|-----------|
| Job lead | `upwork, lead, outbound` |
| Our proposal | `upwork, proposal, outbound` |
| Message | `upwork, message` |
| Job post (hiring) | `upwork, hiring, inbound` |
| Applicant | `upwork, applicant, inbound` |
| Active contract | `upwork, contract, inbound` |
