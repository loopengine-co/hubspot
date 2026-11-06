---
name: hubspot-leads
description: How to use the @loopengine-co/hubspot tools to work through new leads — find who's new, check what the team already knows, record what was done, and keep lead status up to date without duplicating or overwriting anything.
---

# HubSpot leads

The @loopengine-co/hubspot tools read and update the sales team's contacts. Treat
the CRM as shared: read before writing, never duplicate, and record what
you did so the next person (or run) can see it.

## Find who to work on

`hubspot_find_contacts`:

- new sign-ups: `created_in_last_days: 1` (or 7 for the week);
- leads nobody has touched yet: `lead_status: "NEW"`;
- one person: `email`, or `text` for a name or company.

## Check before writing to anyone

Read the contact with `hubspot_get_contact` first:

- `recent_notes` and `last_contacted_at` show whether someone already
  reached out. If they did, don't send a second first email.
- `owner_id` set means a salesperson owns this lead. Leave it to them
  unless asked otherwise; note what you found instead.
- `companies` gives the company's domain, industry and size for
  research.

## Record what you did

After contacting or researching a lead, log it with `hubspot_add_note`:
what you sent or found, in one or two sentences, with links. Notes are
internal; the contact never sees them.

Then move the lead on with `hubspot_update_contact` (it asks a person
first), usually `lead_status: "ATTEMPTED_TO_CONTACT"` after a first
email, or `"UNQUALIFIED"` with a note saying why. Lifecycle stages only
move forward in HubSpot; don't try to move a customer back to lead.

## Creating contacts

Only create a contact when someone new needs to be in the CRM, and
search by email first: `hubspot_create_contact` refuses an email that
already exists and tells you that contact's id, so update it instead.

## Things never to do

- Never overwrite a field a person filled in (owner, company, job title)
  unless asked to.
- Never invent details about a lead in a note; say where each fact came
  from.
- Never mark a lead unqualified without a reason in a note.
