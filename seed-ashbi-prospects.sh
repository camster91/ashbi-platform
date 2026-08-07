#!/bin/bash
# Seed Ashbi DTC prospects + email sequence into hub.ashbi.ca
# Usage: ASHBI_EMAIL='user@example.com' ASHBI_PASSWORD='...' bash seed-ashbi-prospects.sh

BASE="${ASHBI_BASE_URL:-https://hub.ashbi.ca}"
TOKEN=""

if [ -z "${ASHBI_EMAIL:-}" ] || [ -z "${ASHBI_PASSWORD:-}" ]; then
  echo "ASHBI_EMAIL and ASHBI_PASSWORD must be supplied by the approved secret store." >&2
  exit 1
fi

# ---- Step 1: Login to get auth token ----
echo "Logging in..."
LOGIN_RESP=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  --data-binary "$(node -e 'process.stdout.write(JSON.stringify({ email: process.env.ASHBI_EMAIL, password: process.env.ASHBI_PASSWORD }))')")

unset ASHBI_PASSWORD

TOKEN=$(printf '%s' "$LOGIN_RESP" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).token||'')" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "Login failed; response omitted because it may contain sensitive data." >&2
  exit 1
fi
echo "Logged in."

AUTH_HEADER="Authorization: Bearer $TOKEN"

# ---- Step 2: Create Ashbi DTC Sequence ----
echo "Creating Ashbi DTC Email Sequence..."
SEQ_RESP=$(curl -s -X POST "$BASE/cold-email/sequence" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ashbi DTC CPG — Brand Audit Outreach",
    "serviceType": "full_service",
    "targetIndustry": "DTC CPG / Supplements",
    "companyName": "",
    "painPoint": "Brand outgrown by website quality"
  }')

echo "Sequence response: $SEQ_RESP"
SEQ_ID=$(echo $SEQ_RESP | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).id||'')" 2>/dev/null)
echo "Sequence ID: $SEQ_ID"

# ---- Step 3: Seed 4 Ashbi DTC prospects ----
PROSPECTS='[
  {
    "name": "Taylor at VEGAIN",
    "email": "hello@vegain.ca",
    "company": "VEGAIN",
    "industry": "DTC Protein Supplements",
    "painPoint": "Brand innovation not matched by website experience",
    "source": "Ashbi",
    "linkedinUrl": "https://linkedin.com/company/vegain",
    "auditNotes": "H1 reads VEGAIN VEGAIN — double typo impression. No brand story above fold. No urgency/scarcity elements. Crowdfunding launch in progress."
  },
  {
    "name": "Marcus at True North Protein",
    "email": "info@truenorthprotein.com",
    "company": "True North Protein",
    "industry": "DTC Protein Supplements",
    "painPoint": "Premium product, white-label catalog look",
    "source": "Ashbi",
    "linkedinUrl": "https://linkedin.com/company/true-north-protein",
    "auditNotes": "Text-only hero with no lifestyle imagery. 38 flavours as differentiator completely hidden. Rewards program but no homepage social proof. Health Canada licensed but buried."
  },
  {
    "name": "Priya at Pure Lab Vitamins",
    "email": "info@purelabvitamins.com",
    "company": "Pure Lab Vitamins",
    "industry": "DTC Supplements",
    "painPoint": "GMP certified but leading with compliance language",
    "source": "Ashbi",
    "linkedinUrl": "https://linkedin.com/company/pure-lab-vitamins",
    "auditNotes": "Title tag reads like a compliance checklist. Pure Lab name sounds clinical/cold. No DTC lifestyle presence. Made in Canada + GMP + 3rd party tested buried under clinical language."
  },
  {
    "name": "James at Klarify",
    "email": "contact@klarify.com",
    "company": "Klarify",
    "industry": "DTC Health / Diagnostics",
    "painPoint": "Brand positioning unclear for consumer health product",
    "source": "Ashbi",
    "linkedinUrl": "https://linkedin.com/company/klarify",
    "auditNotes": "Brand name suggests clarity but brand story unclear. Product differentiation buried. DTC health space — trust signals needed above fold."
  }
]'

echo "Importing Ashbi DTC prospects..."
IMPORT_RESP=$(curl -s -X POST "$BASE/cold-email/prospects" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"prospects\":$PROSPECTS,\"sequenceId\":\"$SEQ_ID\"}")

echo "Import response: $IMPORT_RESP"

# ---- Step 4: Seed cameronashley.ca prospects (from Pi) ----
CAMERON_PROSPECTS='[
  {"name":"Jason Safe Electrical","email":"safeelectrical@outlook.com","company":"Safe Electrical","industry":"Electrical","painPoint":"No website presence","source":"cameronashley"},
  {"name":"Mark Metro HVAC","email":"contact@metrohvac.ca","company":"Metro HVAC","industry":"HVAC","painPoint":"Outdated website","source":"cameronashley"},
  {"name":"Sarah GTA Plumbing","email":"sarah@gtaplumbing.com","company":"GTA Plumbing","industry":"Plumbing","painPoint":"No leads from website","source":"cameronashley"},
  {"name":"David Oakville Home Services","email":"info@oakvillehomeservices.ca","company":"Oakville Home Services","industry":"Home Services","painPoint":"Brand not memorable","source":"cameronashley"},
  {"name":"Mike Richmond Hill Renovations","email":"mike@richmondhillrenos.ca","company":"Richmond Hill Renovations","industry":"Renovations","painPoint":"Website not generating leads","source":"cameronashley"}
]'

echo "Importing cameronashley prospects..."
CAMERON_IMPORT_RESP=$(curl -s -X POST "$BASE/cold-email/prospects" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"prospects\":$CAMERON_PROSPECTS}")

echo "cameronashley import: $CAMERON_IMPORT_RESP"

echo "Done!"
echo "Next: go to hub.ashbi.ca/cold-email and generate the sequence from the UI"
