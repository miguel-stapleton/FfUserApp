import { NextRequest, NextResponse } from 'next/server'
import axios, { AxiosResponse } from 'axios'
import { prisma } from '@/lib/prisma'
import { requireArtist } from '@/lib/auth'
import { getItemUpdates } from '@/lib/monday'

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN || ''
const CLIENTS_BOARD_ID = 1260828829
const MSTATUS_COL_ID = process.env.MONDAY_MSTATUS_COLUMN_ID || 'project_status'
const HSTATUS_COL_ID = process.env.MONDAY_HSTATUS_COLUMN_ID || 'dup__of_mstatus'
const DATE_COL_ID = 'date6'

function normalize(s: string | null | undefined) {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2013\u2014\-]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

const MUA_EMAIL_TO_PHRASE: Record<string, string> = {
  'gi.lola@gmail.com': 'aceitou as condições de Lola',
  'info@miguelstapleton.art': 'reforçar que é preciso pagar a reserva de Miguel',
  'tecadete@gmail.com': 'aceitou as condições de Teresa',
  'iaguiarmakeup@gmail.com': 'aceitou as condições de Inês',
  'ritarnunes.mua@gmail.com': 'aceitou as condições de Rita',
  'anaferreira.geral@hotmail.com': 'aceitou as condições de Sofia',
  'filipawahnon.mua@gmail.com': 'aceitou as condições de Filipa',
  'anacatarinanev@gmail.com': 'aceitou as condições de Ana Neves',
  'sara.jogo@hotmail.com': 'aceitou as condições de Sara',
  'anaroma.makeup@gmail.com': 'aceitou as condições de Ana Roma',
}

const HS_EMAIL_TO_PHRASE: Record<string, string> = {
  'olga.amaral.hilario@gmail.com': 'aceitou as condições de Olga H',
  'liliapcosta@gmail.com': 'aceitou as condições de Lília',
  'kseniya.hairstylist@gmail.com': 'aceitou as condições de Oksana',
  'riberic@gmail.com': 'aceitou as condições de Eric',
  'andreiadematoshair@gmail.com': 'aceitou as condições de Andreia',
  'joanacarvalho_@hotmail.com': 'aceitou as condições de Joana',
  'hi@letshair.com': 'aceitou as condições de Agne',
}

function statusTextFromColumn(col: any): string {
  const txt = (col?.text || '').trim()
  if (txt) return txt
  if (col?.value) {
    try {
      const parsed = JSON.parse(col.value)
      const label = (parsed?.label || parsed?.text || '').toString().trim()
      if (label) return label
    } catch {}
  }
  return ''
}

function parseMondayDateFromColValue(dateCol: any): Date | null {
  if (!dateCol) return null
  // Prefer the JSON value, which typically looks like: { date: 'YYYY-MM-DD', changed_at: '...' }
  if (dateCol.value) {
    try {
      const parsed = JSON.parse(dateCol.value)
      if (parsed?.date && typeof parsed.date === 'string') {
        const iso = new Date(parsed.date + 'T00:00:00')
        if (!isNaN(iso.getTime())) return iso
      }
    } catch {}
  }
  // Fallback: parse common DD/MM/YYYY or DD-MM-YYYY formats from the text
  const txt: string = dateCol.text || ''
  const m = txt.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if (m) {
    const dd = parseInt(m[1], 10)
    const mm = parseInt(m[2], 10)
    const yyyy = parseInt(m[3], 10)
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy > 1900) {
      const d = new Date(Date.UTC(yyyy, mm - 1, dd))
      if (!isNaN(d.getTime())) return d
    }
  }
  // Last resort: native Date
  const naive = new Date(txt)
  return isNaN(naive.getTime()) ? null : naive
}

function isFutureDateCol(dateCol: any): { ok: boolean; date: Date | null } {
  const d = parseMondayDateFromColValue(dateCol)
  if (!d) return { ok: false, date: null }
  const now = new Date()
  return { ok: d.getTime() > now.getTime(), date: d }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireArtist(request)

    // Find the artist record to get type and email
    const artist = await prisma.artist.findFirst({
      where: { userId: user.id, active: true },
      select: { email: true, type: true },
    })
    if (!artist) {
      return NextResponse.json({ items: [] })
    }

    const isMUA = artist.type === 'MUA'
    const phrase = isMUA ? MUA_EMAIL_TO_PHRASE[artist.email] : HS_EMAIL_TO_PHRASE[artist.email]
    if (!phrase) {
      // Unknown email mapping; return empty
      return NextResponse.json({ items: [] })
    }

    const statusesTarget = isMUA
      ? ['wait for c to pay', 'reunião check']
      : ['wait for c to pay']

    // Fetch all board items (paged)
    let cursor: string | null = null
    const items: any[] = []
    const query = `
      query GetBoardItems($boardId: ID!, $cursor: String) {
        boards(ids: [$boardId]) {
          items_page(limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              column_values { id text value title }
            }
          }
        }
      }
    `

    do {
      const resp: AxiosResponse<any> = await axios.post(
        MONDAY_API_URL,
        { query, variables: { boardId: CLIENTS_BOARD_ID, cursor } },
        { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
      )
      if (resp.data.errors) {
        throw new Error(`Monday API Error: ${JSON.stringify(resp.data.errors)}`)
      }
      const board = resp.data?.data?.boards?.[0]
      const page = board?.items_page
      const pageItems = page?.items || []
      items.push(...pageItems)
      cursor = page?.cursor || null
    } while (cursor)

    // Filter by date and status
    const normTargets = statusesTarget.map(s => normalize(s))
    const statusColId = isMUA ? MSTATUS_COL_ID : HSTATUS_COL_ID

    const candidates = items.filter((item) => {
      const colValues = (item.column_values || []) as Array<any>
      const dateCol = colValues.find(c => c.id === DATE_COL_ID)
      const { ok } = isFutureDateCol(dateCol)
      if (!ok) return false

      const statusCol = colValues.find(c => c.id === statusColId)
      const statusText = statusTextFromColumn(statusCol)
      const statusNorm = normalize(statusText)
      return normTargets.includes(statusNorm)
    })

    // For each candidate, fetch updates and check phrase
    const results: Array<{ id: string; name: string; eventDate: string }> = []
    for (const item of candidates) {
      const updates = await getItemUpdates(String(item.id))
      const combined = updates.map(u => normalize(u.text_body || '')).join(' \n ')
      const hasPhrase = combined.includes(normalize(phrase))
      if (hasPhrase) {
        const dateCol = (item.column_values || []).find((c: any) => c.id === DATE_COL_ID)
        const parsed = isFutureDateCol(dateCol).date
        const display = parsed ? new Date(parsed).toLocaleDateString('en-GB') : (dateCol?.text || '')
        results.push({ id: String(item.id), name: item.name, eventDate: display })
      }
    }

    // Sort by event date ascending
    results.sort((a, b) => {
      const da = new Date(a.eventDate).getTime() || 0
      const db = new Date(b.eventDate).getTime() || 0
      return da - db
    })

    return NextResponse.json({ items: results })
  } catch (error) {
    console.error('[confirm-booking:list] error', error)
    return NextResponse.json({ items: [] })
  }
}
