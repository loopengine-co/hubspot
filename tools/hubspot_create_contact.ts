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

// ---- Contact-writing helpers (same in hubspot_create_contact and hubspot_update_contact)
const WRITABLE = {
  first_name: 'firstname',
  last_name: 'lastname',
  company: 'company',
  job_title: 'jobtitle',
  phone: 'phone',
  website: 'website',
  lifecycle_stage: 'lifecyclestage',
  lead_status: 'hs_lead_status',
} as const

const WRITE_PROPERTIES = {
  first_name: { type: 'string' },
  last_name: { type: 'string' },
  company: { type: 'string' },
  job_title: { type: 'string' },
  phone: { type: 'string' },
  website: { type: 'string' },
  lifecycle_stage: {
    type: 'string',
    enum: ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other'],
    description: 'HubSpot only moves a contact forward through these stages, not back.',
  },
  lead_status: { type: 'string', description: 'e.g. "NEW", "OPEN", "IN_PROGRESS", "ATTEMPTED_TO_CONTACT", "CONNECTED", "UNQUALIFIED", "BAD_TIMING".' },
  other_properties: { type: 'object', description: 'Any other contact properties by their HubSpot internal name, as text values.' },
} as const

function propertiesFromInput(input: Record<string, unknown>): Record<string, string> {
  const props: Record<string, string> = {}
  for (const [field, name] of Object.entries(WRITABLE)) {
    const value = input[field]
    if (typeof value === 'string' && value.trim()) props[name] = name === 'hs_lead_status' ? value.trim().toUpperCase() : value.trim()
  }
  const extra = input.other_properties
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [name, value] of Object.entries(extra as Record<string, unknown>)) {
      if (/^[a-z0-9_]+$/.test(name) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) props[name] = String(value)
    }
  }
  return props
}
// ---- End of contact-writing helpers

export const hubspotCreateContact: ToolDefinition = {
  name: 'hubspot_create_contact',
  description:
    'Create a contact in HubSpot. Search with hubspot_find_contacts first: an email that already exists is refused, and the existing contact\'s id is returned in the error. By default a person approves this first. Returns the new contact.',
  input_schema: {
    type: 'object',
    properties: { email: { type: 'string', description: 'The contact\'s email address.' }, ...WRITE_PROPERTIES },
    required: ['email'],
  },
  execute: async (input, ctx) => {
    const action = 'hubspot_create_contact'
    const email = typeof input.email === 'string' ? input.email.trim() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${action}: email must be a valid email address`)
    try {
      const created = await hubspotRequest<Contact>(ctx.env, action, '/crm/v3/objects/contacts', {
        method: 'POST',
        body: { properties: { ...propertiesFromInput(input), email } },
      })
      return JSON.stringify({ created: true, ...describeContact(created) })
    } catch (err) {
      const e = err as { status?: number; hubspotMessage?: string }
      if (e.status === 409) {
        const existing = /ID: (\d+)/.exec(e.hubspotMessage ?? '')?.[1]
        throw new Error(`${action}: a contact with ${email} already exists${existing ? ` (contact id ${existing})` : ''}; use hubspot_update_contact instead`)
      }
      throw err
    }
  },
}
