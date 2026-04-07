# Ashbi Design - Agency Hub

**An AI-powered client request management system for agencies, built with Fastify, Prisma, and the Claude API.**

Agency Hub is a comprehensive platform for managing client relationships, requests, and communications with AI-assisted workflows and real-time collaboration features.

## Tech Stack

### Backend
- **Framework**: Fastify 5 (high-performance Node.js framework)
- **Database**: Prisma ORM with PostgreSQL
- **Authentication**: JWT with bcrypt password hashing
- **AI Integration**: Anthropic Claude API, Google Gemini
- **Job Queue**: BullMQ with Redis
- **Real-time**: Socket.io for live updates
- **Email**: Mailgun.js for transactional emails
- **Payments**: Stripe for subscriptions
- **Push Notifications**: Web Push API

### Frontend
- **Framework**: React 18 with Vite
- **State Management**: TanStack Query (React Query)
- **Routing**: React Router DOM v7
- **UI Components**: Radix UI primitives
- **Styling**: Tailwind CSS with animations
- **Charts**: Recharts for data visualization
- **Form Handling**: Zod for validation

## Key Features

### Client Management
- **Client Profiles**: Complete client information and history
- **Request Tracking**: Manage and prioritize client requests
- **Communication Hub**: Centralized messaging with clients
- **Health Scoring**: Monitor client engagement and satisfaction

### AI-Powered Features
- **Claude Integration**: AI-assisted request handling and response generation
- **Gemini Integration**: Alternative AI model for specific tasks
- **Contextual AI**: AI understands client history and preferences
- **Automated Workflows**: AI-triggered actions based on request patterns

### Team Collaboration
- **Real-time Updates**: Socket.io powered live collaboration
- **Team Dashboard**: Monitor team performance and workload
- **Activity Feed**: Track all actions and changes
- **Approvals Queue**: Manage pending approvals

### Administrative Tools
- **Analytics Dashboard**: Comprehensive metrics and reporting
- **Brand Settings**: Customize platform appearance
- **Automation Rules**: Set up automated actions
- **Blog Management**: Content management system

## Project Structure

```
Ashbi-Design/
├── src/
│   ├── index.js          # Fastify server entry point
│   ├── controllers/      # Request handlers
│   ├── routes/           # API route definitions
│   ├── services/         # Business logic
│   ├── jobs/             # Background job workers
│   ├── events/           # Socket.io event handlers
│   ├── webhooks/         # Webhook endpoints
│   ├── ai/               # AI integration modules
│   ├── utils/            # Helper functions
│   └── config/           # Configuration files
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── seed.js           # Database seeding
├── web/                  # Frontend React app
├── agents/               # AI agent configurations
├── skills/               # AI skill modules
└── scripts/              # Utility scripts
```

## Installation

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Redis server (for job queues)
- Anthropic API key (Claude)
- Stripe account (for billing)

### Setup

```bash
# Clone the repository
git clone https://github.com/camster91/Ashbi-Design.git
cd Ashbi-Design

# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma db push

# Seed the database
npx prisma db seed

# Start development server
npm run dev
```

## Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development
SESSION_SECRET=your-session-secret

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/agency_hub

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-jwt-secret

# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# Google Gemini
GEMINI_API_KEY=...

# Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Mailgun
MAILGUN_API_KEY=...
MAILGUN_DOMAIN=...

# Web Push
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...

# Google OAuth (optional)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

## Usage

### Development

```bash
# Start backend server (with watch mode)
npm run dev

# Start frontend development server
npm run dev:web

# Start background job worker
npm run dev:worker
```

### Production Build

```bash
# Build frontend
npm run build

# Start production server
npm run start
```

### Database Operations

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Open Prisma Studio
npm run db:studio
```

## API Structure

- `POST /api/auth/*` - Authentication endpoints
- `GET/POST /api/clients/*` - Client management
- `GET/POST /api/requests/*` - Request handling
- `GET/POST /api/team/*` - Team management
- `GET/POST /api/analytics/*` - Analytics data
- `POST /api/webhooks/*` - External webhooks (Stripe, etc.)

## Deployment

### Docker

```bash
docker-compose up -d
```

### PM2 (Production)

```bash
pm2 start ecosystem.config.js
```

## Related Projects

- **Agency Hub Web**: Mobile companion app (Capacitor)
- **GlowOS**: Parent AI platform

## Security

- Rate limiting on all endpoints
- JWT-based authentication
- Password hashing with bcrypt
- Input validation with Zod
- CORS protection
- Helmet.js security headers

## License

Proprietary - All rights reserved.

---

*Built by Cameron Ashley / Nexus AI*
