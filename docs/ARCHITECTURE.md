# Mari CRM Architecture

## Principle
Mari CRM is independent. CenTex Press, Coryell County Scoop, W Health, insurance, and future projects are clients of the CRM rather than owners of it.

## V1 flow
Facebook or another channel -> project signup page -> Mari CRM API -> D1 database -> audience/list membership.

## Core entities
- contacts: canonical person record
- projects: CenTex Press, Scoop, W Health, etc.
- lists: audiences/segments within projects
- memberships: contact-to-list relationship
- consents: auditable email/SMS permission
- forms: public signup configurations
- submissions: provenance for each signup
- campaigns: outbound email/SMS campaign metadata
- campaign_recipients: delivery state

## Privacy/security
Subscriber PII never belongs in GitHub. Secrets are environment variables. Admin endpoints require authentication. Public forms receive only the minimum fields required. Consent is channel-specific and can be withdrawn.

## Deployment
V1 targets Cloudflare Workers + D1 so the application can stay lightweight and inexpensive. The schema is portable SQL and can later migrate to PostgreSQL if scale or features justify it.

## Build order
1. Database schema and migrations
2. Worker API
3. Admin authentication
4. Contact/list dashboard
5. Public form builder and signup endpoint
6. CSV import/export
7. Email provider adapter + unsubscribe
8. SMS adapter + explicit SMS consent
9. Analytics/dashboard
