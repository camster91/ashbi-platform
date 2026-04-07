# Ashbi Hub

Agency management platform for operations, finance, and project management.

## Brand

**Colors:**
- Deep Indigo: `#2e2958` (primary)
- Lime Accent: `#e6f354` (accent)
- Sage Green: `#d0dd9a` (secondary)
- Cream: `#faf9f2` (background)

**Typography:**
- Body: DM Sans
- Headings: Instrument Serif

## Structure

```
ashbi-design/
├── src/                    # Backend (Fastify)
│   ├── routes/             # API endpoints
│   ├── services/           # Business logic
│   ├── ai/                 # AI agents
│   ├── jobs/               # Background jobs
│   └── index.js            # Entry point
├── web/                    # Frontend (Vite + React)
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── pages/          # Route pages
│   │   ├── hooks/          # React hooks
│   │   └── lib/            # Utilities
│   └── package.json
├── prisma/                 # Database schema
├── docker-compose.yml      # Production deployment
└── package.json
```

## Development

```bash
# Install dependencies
npm install
cd web && npm install

# Start backend
npm run dev

# Start frontend (in another terminal)
cd web && npm run dev

# Generate Prisma client
npm run db:generate

# Push schema changes
npm run db:push
```

## Deployment

```bash
# Build
docker-compose build

# Run
docker-compose up -d
```

## Features

### Core (MVP)
- Clients CRM with health tracking
- Projects with tasks, milestones, time tracking
- Invoices, proposals, contracts
- Client portal with view tokens
- User authentication and team management

### AI Agents
- Email triage and drafting
- Content generation (blog, social, LinkedIn)
- Lead generation
- Call screening

### Integrations
- Shopify
- WordPress
- Upwork
- Gmail

## Tech Stack

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Fastify + Prisma
- **Database**: PostgreSQL
- **AI**: Anthropic Claude, Google Gemini, Ollama
- **Deploy**: Docker + Coolify