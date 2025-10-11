import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireArtist, handleAuthError } from '@/lib/auth'
import axios from 'axios'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
const MONDAY_CLIENTS_BOARD_ID = process.env.MONDAY_CLIENTS_BOARD_ID || process.env.MONDAY_BOARD_ID
const MONDAY_TRIAL_DATE_COLUMN_ID = 'date_mkpj7c7s'

// Email to short name mapping (same as booked-clients)
const EMAIL_TO_SHORT_NAME: Record<string, string> = {
  // MUA
  'gi.lola@gmail.com': 'Lola',
  'info@miguelstapleton.art': 'Miguel',
  'tecadete@gmail.com': 'Teresa',
  'iaguiarmakeup@gmail.com': 'Inês',
  'ritarnunes.mua@gmail.com': 'Rita',
  'anaferreira.geral@hotmail.com': 'Sofia',
  'filipawahnon.mua@gmail.com': 'Filipa',
  'anacatarinanev@gmail.com': 'Ana Neves',
  'sara.jogo@hotmail.com': 'Sara',
  'anaroma.makeup@gmail.com': 'Ana Roma',
  // HS
  'olga.amaral.hilario@gmail.com': 'Olga H',
  'liliapcosta@gmail.com': 'Lília',
  'kseniya.hairstylist@gmail.com': 'Oksana',
  'riberic@gmail.com': 'Eric',
  'andreiadematoshair@gmail.com': 'Andreia',
  'hi@letshair.com': 'Agne',
  'joanacarvalho_@hotmail.com': 'Joana',
}

const bodySchema = z.object({
  clientId: z.string().min(1), // Monday item ID from Clients board
  trialDate: z.string().min(1), // YYYY-MM-DD
})

export async function POST(request: NextRequest) {
  try {
    if (!MONDAY_API_TOKEN || !MONDAY_CLIENTS_BOARD_ID) {
      return NextResponse.json({ error: 'Monday configuration missing' }, { status: 500 })
    }

    const user = await requireArtist(request)
    const { clientId, trialDate } = bodySchema.parse(await request.json())

    // 1) Update the Trial date column on Clients board
    const setDateMutation = `
      mutation SetTrialDate($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
      }
    `
    await axios.post(
      MONDAY_API_URL,
      { 
        query: setDateMutation, 
        variables: { 
          boardId: MONDAY_CLIENTS_BOARD_ID, 
          itemId: clientId, 
          columnId: MONDAY_TRIAL_DATE_COLUMN_ID, 
          value: JSON.stringify({ date: trialDate }) 
        } 
      },
      { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
    )

    // 2) Post an update to the Clients board item in Portuguese
    const shortName = EMAIL_TO_SHORT_NAME[user.email] || 'Artista'
    const message = `${shortName} inseriu ${trialDate} para prova desta cliente.`
    const updateMutation = `
      mutation CreateUpdate($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) { id }
      }
    `
    await axios.post(
      MONDAY_API_URL,
      { query: updateMutation, variables: { itemId: clientId, body: message } },
      { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
    )

    // Audit
    await logAudit({
      userId: user.id,
      action: 'ARTIST_LOG_TRIAL',
      entityType: 'CLIENT_ITEM',
      entityId: clientId,
      details: { trialDate },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Log trial error:', error)
    return handleAuthError(error)
  }
}
