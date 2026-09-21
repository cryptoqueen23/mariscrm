# Mari CRM

Independent, lightweight audience CRM for Mari's projects.

## Goals
- One contact record per person
- Multiple projects/lists per contact
- Public signup forms for any project
- Separate email and SMS consent records
- CSV import/export
- Email campaigns and unsubscribe handling
- SMS provider integration later
- Private admin dashboard
- No subscriber PII stored in GitHub

## Architecture
- Web/API: Cloudflare Workers
- Database: Cloudflare D1 (SQLite)
- Public forms: project-specific branded forms calling the CRM API
- Email: provider adapter (configured by environment variables)
- SMS: provider adapter, disabled until configured
- Source of truth: Mari CRM database, not Facebook or any individual website

See docs/ARCHITECTURE.md and db/schema.sql.
