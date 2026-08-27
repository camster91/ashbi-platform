# Phase 2 Agent Deployment Guide

> **Superseded deployment document.** This is a historical implementation plan, not evidence that any agent, schedule, credential, or production deployment is current. Use [docs/product-status.md](docs/product-status.md) for verified product state and [docs/deployment-and-rollback.md](docs/deployment-and-rollback.md) for the only current deployment process. Historical credentials referenced by earlier versions of this file must be reviewed and rotated before any related integration is enabled.

**Created:** 2026-03-20  
**Status:** Historical plan; deployment state unverified

---

## Overview

Five new automation agents have been created for Ashbi Design:

| Agent | Purpose | Schedule | Status |
|-------|---------|----------|--------|
| **upwork-scraper** | Find Upwork jobs (React/WordPress/Shopify) | Every 3 hours | ✅ Ready |
| **email-followup** | Send contextual email follow-ups | Daily 5 PM | ✅ Ready (OAuth setup needed) |
| **notion-mapper** | Map Notion workspace to hub | On-demand | ✅ Ready |
| **arcan-phase2-verify** | Verify Arcan improvements live | Weekly | ✅ Ready |
| **hostinger-db-optimize** | Database optimization for app.influencerslink.com | One-time setup | ✅ Ready |

---

## Quick Start

### Prerequisites

```bash
npm install --save playwright node-fetch googleapis nodemailer
```

### Deploy to GitHub

```bash
cd Ashbi-Design
git add agents/*.js agents/*.sh AGENT_DEPLOYMENT.md
git commit -m "feat: add Phase 2 automation agents"
git push origin main
```

### Deploy to hub.ashbi.ca

```bash
ssh root@187.77.26.99
cd /opt/agency-hub
git pull origin main
npm install
```

---

## Agent Details

### 1. Upwork Job Scraper

**File:** `agents/upwork-scraper.js`

**Features:**
- Searches Upwork for: "React", "WordPress", "Shopify"
- Filters: budget >$500, <50 proposals
- Stores results in hub.ashbi.ca via `/api/opportunities`
- Alerts on opportunities >$2000

**Config (.env):**
```
HUB_API_BASE=https://hub.ashbi.ca/api
HUB_BOT_SECRET=<inject-from-approved-secret-manager>
```

**Run:**
```bash
node agents/upwork-scraper.js
```

**Cron (every 3 hours):**
```bash
0 */3 * * * cd /opt/agency-hub && node agents/upwork-scraper.js >> logs/upwork.log 2>&1
```

---

### 2. Email Follow-up Agent

**File:** `agents/email-followup.js`

**Features:**
- Checks Gmail for "needs_reply" label
- Classifies emails (invoice/proposal/project)
- Generates response templates

**Config (.env):**
```
MAILGUN_API_KEY=<inject-from-approved-secret-manager>
MAILGUN_DOMAIN=ashbi.ca
```

**Setup (first time only):**
```bash
# 1. Create Google Cloud OAuth credentials
# 2. Save to ~/.credentials/gmail-oauth.json
# 3. Run agent once to authenticate
node agents/email-followup.js
```

**Cron (daily 5 PM EST):**
```bash
0 21 * * * cd /opt/agency-hub && node agents/email-followup.js >> logs/email.log 2>&1
```

---

### 3. Notion Workspace Mapper

**File:** `agents/notion-mapper.js`

**Features:**
- Maps entire Notion workspace
- Extracts projects, tasks, team assignments
- Generates sync plan for hub.ashbi.ca

**Config (.env):**
```
NOTION_TOKEN=<inject-from-approved-secret-manager>
HUB_API_BASE=https://hub.ashbi.ca/api
```

**Run (on-demand):**
```bash
node agents/notion-mapper.js
```

**Output:** `memory/notion-workspace-mapping.md`

---

### 4. Arcan Phase 2 Verification

**File:** `agents/arcan-phase2-verify.js`

**Features:**
- Lighthouse audit on arcanpainting.ca
- Code splitting analysis
- Cache verification
- 2FA setup flow test
- Core Web Vitals measurement

**Run:**
```bash
node agents/arcan-phase2-verify.js
```

**Cron (weekly Monday 9 AM):**
```bash
0 9 * * 1 cd /opt/agency-hub && node agents/arcan-phase2-verify.js >> logs/arcan.log 2>&1
```

**Output:** `memory/arcan-phase2-verification.md`

---

### 5. Hostinger Database Optimization

**File:** `agents/hostinger-db-optimize.sh`

**Features:**
- Adds database indexes (timestamp, dedup_key, store_id)
- Creates daily cleanup cron (delete alerts >90 days)
- Installs heartbeat monitoring
- Tests query performance

**Prerequisites:**
```bash
# Obtain temporary SSH access through the approved access process
HOSTINGER_HOST=88.223.82.6
HOSTINGER_PORT=65002
HOSTINGER_USER=u633679196
```

**Run (one-time setup):**
```bash
bash agents/hostinger-db-optimize.sh
```

**Output:**
- `memory/app-influencerslink-fixes-completed.md`
- Cron jobs installed on hostinger1
- Heartbeat monitoring active

---

## Environment Setup

### 1. Copy .env template

```bash
cat > .env <<EOF
# Hub
HUB_API_BASE=https://hub.ashbi.ca/api
HUB_BOT_SECRET=<inject-from-approved-secret-manager>

# Notion
NOTION_TOKEN=<inject-from-approved-secret-manager>

# Mailgun
MAILGUN_API_KEY=<inject-from-approved-secret-manager>
MAILGUN_DOMAIN=ashbi.ca

# Hostinger
HOSTINGER_HOST=88.223.82.6
HOSTINGER_PORT=65002
HOSTINGER_USER=u633679196
EOF
```

### 2. Install cron jobs

```bash
crontab -e

# Add these lines:
0 */3 * * * cd /opt/agency-hub && node agents/upwork-scraper.js >> logs/upwork.log 2>&1
0 21 * * * cd /opt/agency-hub && node agents/email-followup.js >> logs/email.log 2>&1
0 9 * * 1 cd /opt/agency-hub && node agents/arcan-phase2-verify.js >> logs/arcan.log 2>&1
```

### 3. Verify deployment

```bash
# Test Upwork scraper
node agents/upwork-scraper.js

# Test Notion mapper
node agents/notion-mapper.js

# Check logs
tail -f logs/upwork.log
tail -f logs/email.log
tail -f memory/upwork-scraper-log.txt
```

---

## Monitoring

### Log Files

```bash
# Agent logs
memory/upwork-scraper-log.txt
memory/email-agent-log.txt
memory/notion-mapper-log.txt
memory/arcan-phase2-verification.md
memory/app-influencerslink-fixes-completed.md

# Cron logs
logs/upwork.log
logs/email.log
logs/arcan.log
```

### Verification

```bash
# Check Upwork opportunities stored
curl -H "Authorization: Bearer <HUB_BOT_SECRET>" \
  https://hub.ashbi.ca/api/opportunities

# Check heartbeat on hostinger1
ssh -p 65002 u633679196@88.223.82.6
tail /home/u633679196/domains/app.influencerslink.com/data/heartbeat.log
```

---

## Troubleshooting

### Agent won't run
- Check .env variables are set
- Check dependencies installed: `npm ls playwright node-fetch`
- Check logs in memory/ directory

### Upwork scraper finds no jobs
- Check network connectivity: `curl https://www.upwork.com`
- Try with HEADLESS=false to see browser
- Check MIN_BUDGET/MAX_PROPOSALS filters

### Email agent fails
- Check Gmail OAuth credentials set up
- Check MAILGUN_API_KEY is valid
- Check "needs_reply" label exists in Gmail

### Notion mapper returns empty
- Check NOTION_TOKEN is valid
- Check token has appropriate permissions
- Try from Notion API explorer

### Hostinger optimization fails
- Check SSH credentials are correct
- Check port 65002 is accessible
- Verify database file exists

---

## Historical Success Criteria (not verified)

- [ ] Confirm the intended agents still exist in the current source tree
- [ ] Confirm deployment state using current production evidence
- [ ] Confirm environment variables through the approved secret process
- [ ] Confirm schedules from the active scheduler
- [ ] Confirm Gmail OAuth only if the email workflow is re-approved
- [ ] Run bounded tests in a non-production environment
- [ ] Capture current logs without placing credentials in the repository

---

## Next Steps

1. Deploy to hub.ashbi.ca server
2. Set up environment variables
3. Test each agent manually
4. Install cron jobs
5. Monitor logs for 7 days
6. Adjust filters/thresholds as needed
7. Set up alerting (Telegram/email) for high-value opportunities

---

*Phase 2 Agent Deployment Guide*  
*Ashbi Design Internal Use*
