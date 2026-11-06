# @loopengine-co/hubspot

A [loopengine](https://github.com/loopengine-co/loopengine) ability:
HubSpot tools to find and read contacts (with their company and recent
notes), log notes, and create and update contacts, plus a skill on working
through new leads. Creating and updating ask a person first by default.

```sh
npx loopengine add-ability @loopengine-co/hubspot --agent <your-agent>
```

## What's in it

- **Tools**
  - `hubspot_find_contacts(email? | text? | created_in_last_days? |
    lifecycle_stage? | lead_status?, max_results?)` — newest first: id,
    name, email, company, job title, lifecycle stage, lead status, owner,
    source, created and last-contacted dates.
  - `hubspot_get_contact(contact)` — one contact in full, the companies it
    belongs to (name, domain, industry, size), and its 10 most recent
    notes.
  - `hubspot_add_note(contact, text)` — logs an internal note on the
    contact's timeline.
  - `hubspot_create_contact(email, first_name?, last_name?, company?,
    job_title?, phone?, website?, lifecycle_stage?, lead_status?,
    other_properties?)` — refuses an email that already exists and says
    which contact has it.
  - `hubspot_update_contact(contact, …same fields…)` — changes only the
    fields given.

  `contact` takes a HubSpot contact id or an email address.
  `other_properties` sets any other contact property by its internal
  name.
- **Skill** — `hubspot-leads`: finding new leads, checking notes and
  ownership before writing to anyone, logging what was done, and moving
  lead status on.
- **actauth rules** — finding, reading and adding notes are `allow`;
  creating and updating contacts are `ask`.

## Setup

1. In HubSpot, go to **Settings → Integrations → Private Apps → Create a
   private app** (in newer accounts: **Development → Legacy apps →
   Create → Private**).
2. On **Scopes**, add:

| Scope | Used by |
| --- | --- |
| `crm.objects.contacts.read` | finding and reading contacts and their notes |
| `crm.objects.contacts.write` | creating and updating contacts, adding notes |
| `crm.objects.companies.read` | the companies on `hubspot_get_contact` |

3. Create the app and copy its **access token** (starts `pat-`).
4. Set it as `HUBSPOT_ACCESS_TOKEN` in the agent's **Environment** tab in
   the console. It's shared by default; give an agent its own to work in a
   different HubSpot account.

## Permissions

| Tool | Default | Why |
| --- | --- | --- |
| `hubspot_find_contacts`, `hubspot_get_contact` | allow | Read only |
| `hubspot_add_note` | allow | Internal, and easy to delete |
| `hubspot_create_contact`, `hubspot_update_contact` | ask | Changes the sales team's shared data |

Change these in the agent's Permissions tab.
