import type { AgentEnv, ToolDefinition } from 'loopengine'

// ---- Shared request helpers ----------------------------------------
// Duplicated verbatim across every tool file in this ability: add-ability
// copies each tool file standalone, with no shared-module support, so
// this block is the contract between them. Keep the copies identical.
//
// Uses HubSpot's CRM v3/v4 API with a private app token. Settings come
// from ctx.env, not process.env: loopengine resolves them per agent (see
// loopengine.ability.json's `scope`).
const HUBSPOT_API = 'https://api.hubapi.com'

const CONTACT_PROPERTIES = [
  'email', 'firstname', 'lastname', 'company', 'jobtitle', 'phone', 'website',
  'lifecyclestage', 'hs_lead_status', 'hubspot_owner_id', 'hs_analytics_source',
  'createdate', 'lastmodifieddate', 'notes_last_contacted',
]

async function hubspotRequest<T>(env: AgentEnv, action: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = env.get('HUBSPOT_ACCESS_TOKEN')
  if (!token) throw new Error(`${action}: HUBSPOT_ACCESS_TOKEN is not set (see @loopengine-co/hubspot's README)`)
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  if (res.status === 204) return {} as T
  const body = (await res.json().catch(() => ({}))) as T & { message?: string; category?: string }
  if (!res.ok) {
    const hint =
      res.status === 401
        ? ' The access token is invalid or was rotated.'
        : res.status === 403
          ? ' The private app is missing a scope this needs (see @loopengine-co/hubspot\'s README).'
          : res.status === 429
            ? ' HubSpot is rate limiting; try again in a few seconds.'
            : ''
    const error = new Error(`${action}: HubSpot error ${res.status}${body.message ? `: ${body.message}` : ''}.${hint}`) as Error & { status?: number; hubspotMessage?: string }
    error.status = res.status
    error.hubspotMessage = body.message
    throw error
  }
  return body
}

interface Contact {
  id: string
  properties: Record<string, string | null>
}

function describeContact(c: Contact) {
  const p = c.properties
  return {
    contact_id: c.id,
    name: [p.firstname, p.lastname].filter(Boolean).join(' ') || null,
    email: p.email ?? null,
    company: p.company ?? null,
    job_title: p.jobtitle ?? null,
    phone: p.phone ?? null,
    website: p.website ?? null,
    lifecycle_stage: p.lifecyclestage ?? null,
    lead_status: p.hs_lead_status ?? null,
    owner_id: p.hubspot_owner_id ?? null,
    source: p.hs_analytics_source ?? null,
    created_at: p.createdate ?? null,
    last_contacted_at: p.notes_last_contacted ?? null,
  }
}

// A contact is named by its HubSpot id (digits) or its email address.
function contactPath(action: string, ref: unknown): string {
  const value = typeof ref === 'number' ? String(ref) : typeof ref === 'string' ? ref.trim() : ''
  if (/^\d+$/.test(value)) return `/crm/v3/objects/contacts/${value}`
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `/crm/v3/objects/contacts/${encodeURIComponent(value)}?idProperty=email`
  throw new Error(`${action}: contact must be a HubSpot contact id or an email address`)
}

function withQuery(path: string, params: Record<string, string>): string {
  return `${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`
}
// ---- End of shared helpers -----------------------------------------

// HubSpot's own association type for "note to contact".
const NOTE_TO_CONTACT = 202

export const hubspotAddNote: ToolDefinition = {
  name: 'hubspot_add_note',
  description:
    'Log an internal note on a HubSpot contact\'s timeline, e.g. "Sent first email about the Growth plan; mentioned their new Austin store." Use it to record what you did and found, so the team (and later runs) can see it. Notes are internal; the contact never sees them. contact is a contact id or an email address. Returns the note id.',
  input_schema: {
    type: 'object',
    properties: {
      contact: { type: 'string', description: 'The contact id, or the contact\'s email address.' },
      text: { type: 'string', description: 'The note, as plain text.' },
    },
    required: ['contact', 'text'],
  },
  execute: async (input, ctx) => {
    const action = 'hubspot_add_note'
    const body = typeof input.text === 'string' ? input.text.trim() : ''
    if (!body) throw new Error(`${action}: text is required`)
    let contact: Contact
    try {
      contact = await hubspotRequest<Contact>(ctx.env, action, withQuery(contactPath(action, input.contact), { properties: 'email' }))
    } catch (err) {
      if ((err as { status?: number }).status === 404) throw new Error(`${action}: no contact ${String(input.contact)} in HubSpot`)
      throw err
    }
    // HubSpot stores note bodies as HTML: escape the text, keep its lines.
    const html = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
    const note = await hubspotRequest<{ id: string }>(ctx.env, action, '/crm/v3/objects/notes', {
      method: 'POST',
      body: {
        properties: { hs_note_body: html, hs_timestamp: new Date().toISOString() },
        associations: [{ to: { id: contact.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_CONTACT }] }],
      },
    })
    return JSON.stringify({ note_id: note.id, contact_id: contact.id })
  },
}
