# Fresh Faced - Artist Proposal Management System

A Next.js 14 application for managing beauty artist proposals with Monday.com integration, PWA support, and real-time notifications.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
Copy `.env.example` to `.env.local` and configure all variables:

```bash
cp .env.example .env.local
```

### 3. Database Setup
```bash
# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# Seed BACKOFFICE user
npm run seed
```

### 4. Development Server
```bash
npm run dev
```

## 🔧 Environment Variables

### Database
```env
DATABASE_URL="postgresql://username:password@localhost:5432/fresh_faced_db"
```
**Source**: Your PostgreSQL database connection string

### Authentication
```env
JWT_SECRET="your-super-secret-jwt-key-here"
```
**Source**: Generate a secure random string (32+ characters)

### Monday.com API Configuration
```env
MONDAY_API_TOKEN="your_monday_api_token_here"
MONDAY_BOARD_ID="your_main_board_id_here"
MONDAY_MUA_BOARD_ID="your_mua_board_id_here"
MONDAY_HS_BOARD_ID="your_hs_board_id_here"
MONDAY_EMAIL_AUTOMATION_COLUMN_ID="email_automation_column_id"
```
**Source**: Monday.com Developer Settings
- API Token: Monday.com → Profile → Admin → API
- Board IDs: URL when viewing each board
- Column IDs: Found in board settings or API explorer

### Monday.com Column IDs (for live data fetching)
```env
MONDAY_MSTATUS_COLUMN_ID="mua_status_column_id"
MONDAY_HSTATUS_COLUMN_ID="hs_status_column_id"
MONDAY_CHOSEN_MUA_COLUMN_ID="chosen_mua_column_id"
MONDAY_CHOSEN_HS_COLUMN_ID="chosen_hs_column_id"
```
**Source**: Monday.com board column settings
- Right-click column header → "Column Settings" → Copy column ID
- Or use Monday.com API explorer to inspect board structure

### BACKOFFICE User Credentials
```env
BACKOFFICE_EMAIL="admin@freshfaced.com"
BACKOFFICE_PASSWORD="secure_admin_password"
```
**Source**: Set your desired admin credentials

### PWA Push Notifications
```env
# Web Push VAPID keys (server and client)
VAPID_PUBLIC_KEY="your_vapid_public_key"        # used by server in lib/push.ts
VAPID_PRIVATE_KEY="your_vapid_private_key"      # used by server in lib/push.ts
NEXT_PUBLIC_VAPID_PUBLIC_KEY="your_vapid_public_key"  # used by browser to subscribe
VAPID_SUBJECT="mailto:your-email@domain.com"
```
**Source**: Generate VAPID keys using web-push library:
```bash
npx web-push generate-vapid-keys
```

## 👤 BACKOFFICE Account Setup

### 1. Set Environment Variables
Configure `BACKOFFICE_EMAIL` and `BACKOFFICE_PASSWORD` in `.env.local`

### 2. Run Seed Script
```bash
npm run seed
```

### 3. Login
- Navigate to `/login`
- Use your `BACKOFFICE_EMAIL` and `BACKOFFICE_PASSWORD`
- You'll be redirected to `/(backoffice)/proposals`

## 🔗 Monday.com Webhook Setup

### Required Webhooks
Set up webhooks in Monday.com to trigger on status changes:

#### 1. MUA Status Changes
- **Board**: MUA Artists Board
- **Trigger**: Column value changed
- **Column**: MUA Status (Mstatus)
- **URL**: `https://yourdomain.com/api/webhooks/monday`
- **Method**: POST

#### 2. HS Status Changes
- **Board**: HS Artists Board  
- **Trigger**: Column value changed
- **Column**: HS Status (Hstatus)
- **URL**: `https://yourdomain.com/api/webhooks/monday`
- **Method**: POST

#### 3. Item Created (Optional)
- **Board**: Clients Board
- **Trigger**: Item created
- **URL**: `https://yourdomain.com/api/webhooks/monday`
- **Method**: POST

### Webhook Configuration Steps
1. Go to Monday.com → Your Board → Integrations
2. Click "Add Integration" → "Webhooks"
3. Configure trigger conditions
4. Set endpoint URL to your deployed application
5. Add authentication headers if needed
6. Test webhook delivery

## ⏰ Cron Job Setup

### Vercel Cron Jobs
Add to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/jobs/process-deadlines",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

### Alternative Cron Services
For other platforms, set up a cron job to POST to:
```
POST https://yourdomain.com/api/jobs/process-deadlines
```
**Frequency**: Every 5 minutes
**Purpose**: Process expired proposal batches and trigger email automations

### Manual Testing
Use the debug panel at `/debug` (BACKOFFICE only) to manually trigger deadline processing.

## 📱 PWA Push Notifications

### Requirements
- **HTTPS**: Push notifications require HTTPS in production
- **VAPID Keys**: Generate using `npx web-push generate-vapid-keys`
- **Service Worker**: Automatically registered via Next.js

### Setup Steps
1. Generate VAPID keys and add to environment variables
2. Deploy to HTTPS domain
3. Artists will be prompted to allow notifications on first visit
4. Notifications sent when new proposals are created

### Testing
- Use browser dev tools → Application → Service Workers
- Check notification permissions in browser settings
- Test with debug panel batch creation

## Android Quick-Start (Artists)

Follow these steps on Android (Chrome):

1. Open the app URL over HTTPS in Chrome.
2. Tap the banner/button "Enable notifications" if shown, or go to the menu and enable from settings.
3. When prompted, allow notifications.
4. Optional: Install the app (Chrome menu → "Add to Home screen").
5. You should now receive push notifications when new proposals are available.

Troubleshooting on Android:

- Open Chrome → Settings → Site settings → Notifications → ensure the site is Allowed.
- In the app, open DevTools → Application → Service Workers and verify `/sw.js` is active and running.
- Check DevTools Console for log lines like `Service Worker registered:` from `lib/push-client.ts`.
- If you still don’t receive pushes, try re-enabling notifications: unsubscribe (if implemented), then enable again to refresh the subscription.
- Ensure these env vars are configured on the deployment:
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (server)
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client)

## 📊 Data Model Overview

### Core Entities
- **User**: Authentication (ARTIST/BACKOFFICE roles)
- **Artist**: Extended profile with type (MUA/HS) and tier
- **ClientService**: Wedding services linked to Monday.com
- **ProposalBatch**: Groups proposals (SINGLE/BROADCAST modes)
- **Proposal**: Individual artist proposals with YES/NO responses

### Key Relationships
```
User (1:1) Artist (1:M) Proposals
ClientService (1:M) ProposalBatch (1:M) Proposals
```

## 🔄 Event Flow

### 1. Client Status Change (Monday.com)
```
Monday.com Webhook → Status Change → Create ClientService → Start Proposal Batch
```

### 2. Proposal Lifecycle
```
SINGLE Batch → Artist Response → YES: Send Options | NO: Start BROADCAST
BROADCAST Batch → Multiple Responses → Deadline → Process Results
```

### 3. Deadline Processing
```
Cron Job (5min) → Check Expired Batches → Send Email Automation → Update Status
```

### 4. Business Rules
- **MUA OR HS**: Artists can only be one type (enforced at signup)
- **No Distance Limits**: All active artists receive BROADCAST proposals
- **24h Timeout**: SINGLE batches without response trigger BROADCAST
- **Proposal Hiding**: Only responding artist sees proposal as hidden

## 🛠 Development Tools

### Debug Panel (`/debug`)
- **Access**: BACKOFFICE users only
- **Features**: Create test batches, view deadlines, manual deadline processing
- **Purpose**: Testing without Monday.com integration

### Available Scripts
```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Production server
npm run lint         # ESLint check
npm run format       # Prettier format
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Run migrations
npm run seed         # Seed BACKOFFICE user
```

## 🔐 Security Notes

- JWT tokens stored in httpOnly cookies
- Role-based access control (ARTIST/BACKOFFICE)
- Monday.com webhook authentication
- Environment variables for sensitive data
- HTTPS required for PWA features

## 📱 Mobile Support

- Mobile-first responsive design
- PWA installable on mobile devices
- Touch-optimized interfaces
- Offline capability via service worker

---

For issues or questions, check the debug panel at `/debug` or review the audit logs in the database.
