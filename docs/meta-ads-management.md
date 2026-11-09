# Ashbi Meta Ads management

## Operating decision

Ashbi uses Meta Business Suite and Ads Manager as the execution surface. Each client owns their Meta Business Portfolio, Page, Instagram account, ad account, Dataset/Pixel, website, and Meta payment method. The client grants Ashbi partner access with the minimum required permissions.

Ashbi Workspace is the agency system of record for client onboarding, account readiness, campaign planning, creative production and approvals, manual lead follow-up, and reporting.

This first release is deliberately **manual**:
- No Meta Marketing API, OAuth token, client password, or personal login is collected.
- No campaign is published, paused, edited, or budget-adjusted from Ashbi Workspace.
- No ad spend or payment method is handled by Ashbi Workspace.
- Campaign state and performance are operator-entered records, not live Meta data. Every view must say so.
- Clients approve or request changes to creative drafts in Ashbi Workspace; approval never publishes an ad.

## Ownership and access

| Asset / action | Owner or execution surface |
|---|---|
| Business Portfolio, Page, Instagram, ad account, Dataset | Client's Meta Business Portfolio |
| Ad billing and payment method | Client directly in Meta |
| Audiences, placements, delivery, publishing, pause/resume | Meta Ads Manager |
| Client onboarding and partner-access checklist | Ashbi Workspace |
| Campaign briefs, creative drafts and client approval | Ashbi Workspace |
| Lead qualification and follow-up | Ashbi Workspace |
| Manual performance reports | Ashbi Workspace |

Ashbi staff can manage client workspaces within the agency organization. A client portal identity is restricted to its own linked client record. Client users can see only campaigns, creatives, leads and reports deliberately shared with them. Clients can approve or request changes only to creatives explicitly submitted for their review.

## MVP workflow

1. Create or select an existing Ashbi client record.
2. Add the client's Meta Business details and website/service area.
3. Record Ashbi's Business ID for the client and complete the partner-access and launch-readiness checklist. The client uses this ID in Meta Business Settings → Users → Partners → Add.
4. Create a campaign plan with objective, conversion destination, daily budget, service area and dates.
5. Prepare ad creative, copy and asset reference.
6. Share the creative with the client for approval.
7. Record the client's approval or requested changes.
8. Implement the approved campaign manually in Meta Ads Manager.
9. Record leads manually from Meta lead notifications / lead centre, and track follow-up.
10. Enter reporting snapshots from Meta Ads Manager and record booked estimates, won jobs and revenue.

## Data handling

Lead records contain personal contact information. Collect only what is needed to respond to the enquiry, restrict it to the linked client and authorized Ashbi staff, keep internal notes private, and share lead details with the client only where appropriate. Do not import or copy lead lists into other clients' workspaces. Establish and follow the client's privacy notice, consent basis, retention period and deletion process before storing real leads. Use synthetic leads in testing.

## Reporting definitions

- Spend, revenue and budgets are stored in integer minor units with an explicit currency.
- Never aggregate money across currencies.
- Cost per lead = spend / leads.
- Qualified CPL = spend / qualified leads.
- Estimate booking rate = estimates booked / leads.
- Job win rate = jobs won / estimates booked.
- ROAS = attributed revenue / spend; show only where spend is greater than zero and revenue attribution is available.
- Metrics entered manually must show the reporting date and source as Meta Ads Manager / operator-entered.

## Launch and change controls

The Workspace records plans and approvals; it does not operate Meta. Publishing, changing live campaign budgets, changing payment methods, changing client asset ownership/access, importing real lead lists, sending customer messages, or deploying this module to production require separate action-time authorization.