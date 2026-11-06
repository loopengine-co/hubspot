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

const LIFECYCLE_STAGES = ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other']

export const hubspotFindContacts: ToolDefinition = {
  name: 'hubspot_find_contacts',
  description:
    'Find contacts in HubSpot, newest first: id, name, email, company, job title, lifecycle stage, lead status, owner, source, created and last-contacted dates. Search by exact email, by free text (name, email or company), by how recently they were created (e.g. new sign-ups in the last 1 day), by lifecycle stage, or by lead status. Read one in full, with notes, with hubspot_get_contact.',
  input_schema: {
    type: 'object',
    properties: {
      email: { type: 'string', description: 'An exact email address.' },
      text: { type: 'string', description: 'Free text matched against name, email, company and other default fields.' },
      created_in_last_days: { type: 'number', description: 'Only contacts created in the last N days, e.g. 1 for new sign-ups today.' },
      lifecycle_stage: { type: 'string', enum: LIFECYCLE_STAGES, description: 'Only contacts in this lifecycle stage.' },
      lead_status: { type: 'string', description: 'Only contacts with this lead status, e.g. "NEW" or "ATTEMPTED_TO_CONTACT".' },
      max_results: { type: 'number', description: 'How many contacts to return, 1 to 50. Default 10.' },
    },
    required: [],
  },
  execute: async (input, ctx) => {
    const action = 'hubspot_find_contacts'
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string).trim() : '')
    const filters: { propertyName: string; operator: string; value: string }[] = []
    if (text('email')) filters.push({ propertyName: 'email', operator: 'EQ', value: text('email') })
    const days = Number(input.created_in_last_days)
    if (days > 0) filters.push({ propertyName: 'createdate', operator: 'GTE', value: String(Date.now() - Math.round(days * 86_400_000)) })
    if (text('lifecycle_stage')) {
      if (!LIFECYCLE_STAGES.includes(text('lifecycle_stage'))) throw new Error(`${action}: lifecycle_stage must be one of ${LIFECYCLE_STAGES.join(', ')}`)
      filters.push({ propertyName: 'lifecyclestage', operator: 'EQ', value: text('lifecycle_stage') })
    }
    if (text('lead_status')) filters.push({ propertyName: 'hs_lead_status', operator: 'EQ', value: text('lead_status').toUpperCase() })
    if (!filters.length && !text('text')) throw new Error(`${action}: give an email, text, created_in_last_days, lifecycle_stage or lead_status`)

    const data = await hubspotRequest<{ total: number; results: Contact[] }>(ctx.env, action, '/crm/v3/objects/contacts/search', {
      method: 'POST',
      body: {
        ...(filters.length ? { filterGroups: [{ filters }] } : {}),
        ...(text('text') ? { query: text('text') } : {}),
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        properties: CONTACT_PROPERTIES,
        limit: Math.max(1, Math.min(50, Math.floor(Number(input.max_results) || 10))),
      },
    })
    return JSON.stringify({ total: data.total, contacts: data.results.map(describeContact) })
  },
  safe: true,
}
