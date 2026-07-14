import { createClient } from '@supabase/supabase-js'

export const ffadmin = createClient(
  process.env.FFADMIN_SUPABASE_URL!,
  process.env.FFADMIN_SUPABASE_ANON_KEY!
)

// email → polls boolean column name
export const EMAIL_TO_POLL_COLUMN: Record<string, string> = {
  'gi.lola@gmail.com':              'lola',
  'info@miguelstapleton.art':       'miguel',
  'tecadete@gmail.com':             'teresa',
  'iaguiarmakeup@gmail.com':        'ines',
  'anaroma.makeup@gmail.com':       'roma',
  'anaferreira.geral@hotmail.com':  'sofia',
  'anacatarinanev@gmail.com':       'neves',
  'ritarnunes.mua@gmail.com':       'rita',
  'sara.jogo@hotmail.com':          'sara',
  'filipawahnon.mua@gmail.com':     'filipa',
  'olga.amaral.hilario@gmail.com':  'olga_hilario',
  'kseniya.hairstylist@gmail.com':  'oksana',
  'riberic@gmail.com':              'eric',
  'andreiadematoshair@gmail.com':   'andreia_de_matos',
  'hi@letshair.com':                'agne',
  'joanacarvalho_@hotmail.com':     'joana',
  'liliapcosta@gmail.com':          'lilia',
}

// email → display name for activity log messages
export const EMAIL_TO_DISPLAY_NAME: Record<string, string> = {
  'gi.lola@gmail.com':              'Lola',
  'info@miguelstapleton.art':       'Miguel',
  'tecadete@gmail.com':             'Teresa',
  'iaguiarmakeup@gmail.com':        'Inês',
  'anaroma.makeup@gmail.com':       'Ana Roma',
  'anaferreira.geral@hotmail.com':  'Sofia',
  'anacatarinanev@gmail.com':       'Ana Neves',
  'ritarnunes.mua@gmail.com':       'Rita',
  'sara.jogo@hotmail.com':          'Sara',
  'filipawahnon.mua@gmail.com':     'Filipa',
  'olga.amaral.hilario@gmail.com':  'Olga H',
  'kseniya.hairstylist@gmail.com':  'Oksana',
  'riberic@gmail.com':              'Eric',
  'andreiadematoshair@gmail.com':   'Andreia',
  'hi@letshair.com':                'Agne',
  'joanacarvalho_@hotmail.com':     'Joana',
  'liliapcosta@gmail.com':          'Lília',
}

// FFadmin display name (chosen_mua/chosen_hs value) → artist email
// Names in FFadmin may look like "Miguel Stapleton (NG)" — we match by normalised first token
export function resolveArtistEmailFromDisplayName(
  displayName: string | null,
  serviceType: 'MUA' | 'HS'
): string | null {
  if (!displayName) return null
  const norm = displayName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*\(.*?\)\s*$/, '') // strip trailing "(NG)" etc.
    .trim()

  const MUA_MAP: Record<string, string> = {
    'lola':      'gi.lola@gmail.com',
    'miguel':    'info@miguelstapleton.art',
    'teresa':    'tecadete@gmail.com',
    'ines':      'iaguiarmakeup@gmail.com',
    'ana roma':  'anaroma.makeup@gmail.com',
    'sofia':     'anaferreira.geral@hotmail.com',
    'ana neves': 'anacatarinanev@gmail.com',
    'rita':      'ritarnunes.mua@gmail.com',
    'sara':      'sara.jogo@hotmail.com',
    'filipa':    'filipawahnon.mua@gmail.com',
  }
  const HS_MAP: Record<string, string> = {
    'olga h':         'olga.amaral.hilario@gmail.com',
    'olga hilario':   'olga.amaral.hilario@gmail.com',
    'oksana':         'kseniya.hairstylist@gmail.com',
    'eric':           'riberic@gmail.com',
    'andreia':        'andreiadematoshair@gmail.com',
    'agne':           'hi@letshair.com',
    'joana':          'joanacarvalho_@hotmail.com',
    'lilia':          'liliapcosta@gmail.com',
  }

  const map = serviceType === 'MUA' ? MUA_MAP : HS_MAP
  if (map[norm]) return map[norm]
  for (const [key, email] of Object.entries(map)) {
    if (norm.startsWith(key) || norm.includes(key)) return email
  }
  return null
}

export async function addFFadminActivityLog(
  clientId: number,
  message: string,
  author = 'Artist',
  type = 'artist',
  isGuest = false
) {
  const { error } = await ffadmin.from('activity_log').insert({
    ...(isGuest ? { guest_id: clientId } : { client_id: clientId }),
    message,
    author,
    type,
  })
  if (error) console.error('[ffadmin] activity_log insert failed:', error)
}
