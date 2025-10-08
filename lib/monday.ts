import axios from 'axios'
import { MondayArtist, MondayClient } from './types'

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
const MONDAY_BOARD_ID = process.env.MONDAY_BOARD_ID

interface MondayClientLegacy {
  id: string
  name: string
  email?: string
  phone?: string
  status?: string
}

export class MondayService {
  private apiToken: string
  private boardId: string

  constructor() {
    if (!MONDAY_API_TOKEN || !MONDAY_BOARD_ID) {
      throw new Error('Monday.com API credentials not configured')
    }
    this.apiToken = MONDAY_API_TOKEN
    this.boardId = MONDAY_BOARD_ID
  }

  private async makeRequest(query: string, variables?: any) {
    try {
      const response = await axios.post(
        MONDAY_API_URL,
        {
          query,
          variables,
        },
        {
          headers: {
            'Authorization': this.apiToken,
            'Content-Type': 'application/json',
          },
        }
      )

      if (response.data.errors) {
        throw new Error(`Monday API Error: ${JSON.stringify(response.data.errors)}`)
      }

      return response.data.data
    } catch (error) {
      console.error('Monday API request failed:', error)
      throw error
    }
  }

  /**
   * Set email automation for a client item
   */
  async setEmailAutomation(itemId: string, automationType: 'Send options' | 'Send no availability'): Promise<boolean> {
    const query = `
      mutation UpdateItem($itemId: ID!, $boardId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          item_id: $itemId,
          board_id: $boardId,
          column_values: $columnValues
        ) {
          id
        }
      }
    `

    try {
      const emailAutomationColumnId = process.env.MONDAY_EMAIL_AUTOMATION_COLUMN_ID
      if (!emailAutomationColumnId) {
        throw new Error('Email automation column ID not configured')
      }

      await this.makeRequest(query, {
        itemId,
        boardId: this.boardId,
        columnValues: JSON.stringify({
          [emailAutomationColumnId]: automationType
        })
      })
      return true
    } catch (error) {
      console.error('Failed to set email automation:', error)
      return false
    }
  }

  async getClientInfo(itemId: string): Promise<MondayClientLegacy | null> {
    const query = `
      query GetItem($itemId: ID!) {
        items(ids: [$itemId]) {
          id
          name
          column_values {
            id
            text
          }
        }
      }
    `

    try {
      const data = await this.makeRequest(query, { itemId })
      const item = data.items[0]

      if (!item) {
        return null
      }

      // Extract client information from column values
      const columnValues = item.column_values || []
      const emailColumn = columnValues.find((col: any) => col.id === 'email4' || col.id === 'email')
      const phoneColumn = columnValues.find((col: any) => col.id === 'phone')
      const statusColumn = columnValues.find((col: any) => col.id === 'status')

      return {
        id: item.id,
        name: item.name,
        email: emailColumn?.text || undefined,
        phone: phoneColumn?.text || undefined,
        status: statusColumn?.text || undefined,
      }
    } catch (error) {
      console.error('Failed to get client info:', error)
      return null
    }
  }

  async getAllClients(): Promise<MondayClientLegacy[]> {
    const query = `
      query GetBoardItems($boardId: ID!) {
        boards(ids: [$boardId]) {
          items_page(limit: 50) {
            items {
              id
              name
              column_values {
                id
                text
              }
            }
          }
        }
      }
    `

    try {
      const data = await this.makeRequest(query, { boardId: this.boardId })
      const board = data.boards[0]

      if (!board) {
        return []
      }

      return board.items_page.items.map((item: any) => {
        const columnValues = item.column_values || []
        const emailColumn = columnValues.find((col: any) => col.id === 'email4' || col.id === 'email')
        const phoneColumn = columnValues.find((col: any) => col.id === 'phone')
        const statusColumn = columnValues.find((col: any) => col.id === 'status')

        return {
          id: item.id,
          name: item.name,
          email: emailColumn?.text || undefined,
          phone: phoneColumn?.text || undefined,
          status: statusColumn?.text || undefined,
        }
      })
    } catch (error) {
      console.error('Failed to get all clients:', error)
      return []
    }
  }

  async updateClientStatus(itemId: string, status: string): Promise<boolean> {
    const query = `
      mutation UpdateItem($itemId: ID!, $boardId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          item_id: $itemId,
          board_id: $boardId,
          column_values: $columnValues
        ) {
          id
        }
      }
    `

    try {
      await this.makeRequest(query, {
        itemId,
        boardId: this.boardId,
        columnValues: JSON.stringify({
          status: status
        })
      })
      return true
    } catch (error) {
      console.error('Failed to update client status:', error)
      return false
    }
  }
}

export const mondayService = new MondayService()

// Standalone functions for compatibility
export async function findArtistByEmail(email: string): Promise<MondayArtist | null> {
  const query = `
    query FindArtistByEmail($muaBoardId: ID!, $hsBoardId: ID!) {
      boards(ids: [$muaBoardId, $hsBoardId]) {
        id
        name
        items_page(limit: 50) {
          items {
            id
            name
            column_values {
              id
              text
            }
          }
        }
      }
    }
  `

  try {
    if (!MONDAY_API_TOKEN) {
      throw new Error('Monday.com API token not configured')
    }

    const response = await axios.post(
      MONDAY_API_URL,
      { 
        query, 
        variables: { 
          muaBoardId: process.env.MONDAY_MUA_BOARD_ID,
          hsBoardId: process.env.MONDAY_HS_BOARD_ID
        } 
      },
      {
        headers: {
          'Authorization': MONDAY_API_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    )

    if (response.data.errors) {
      throw new Error(`Monday API Error: ${JSON.stringify(response.data.errors)}`)
    }

    const boards = response.data.data.boards
    
    console.log('=== DEBUG: findArtistByEmail ===')
    console.log('Searching for email:', email)
    console.log('MUA Board ID from env:', process.env.MONDAY_MUA_BOARD_ID)
    console.log('HS Board ID from env:', process.env.MONDAY_HS_BOARD_ID)
    console.log('Number of boards returned:', boards?.length)
    
    // Search for artist by email across both MUA and HS boards
    for (const board of boards) {
      console.log('\nChecking board:', board.id, 'Name:', board.name)
      console.log('Board ID matches MUA?', board.id === process.env.MONDAY_MUA_BOARD_ID)
      console.log('Board ID matches HS?', board.id === process.env.MONDAY_HS_BOARD_ID)
      console.log('Number of items:', board.items_page.items.length)
      
      for (const item of board.items_page.items) {
        console.log('\n  Item:', item.name, 'ID:', item.id)
        
        // Determine the correct email column based on board type
        let emailColumn
        if (board.id === process.env.MONDAY_MUA_BOARD_ID) {
          // MUA board uses "MUAEmail" column with ID 'email'
          console.log('  Looking for MUA email column...')
          emailColumn = item.column_values.find((col: any) => 
            col.id === 'email' || col.title?.toLowerCase().includes('muaemail')
          )
        } else if (board.id === process.env.MONDAY_HS_BOARD_ID) {
          // HS board uses "HEmail" column with ID 'email'
          console.log('  Looking for HS email column...')
          emailColumn = item.column_values.find((col: any) => 
            col.id === 'email' || col.title?.toLowerCase().includes('hemail')
          )
        }
        
        if (emailColumn) {
          console.log('  Found email column:', emailColumn.id, 'Value:', emailColumn.text)
        } else {
          console.log('  No email column found. Available columns:')
          item.column_values.forEach((col: any) => {
            console.log('    -', col.id, ':', col.text)
          })
        }
        
        if (emailColumn && emailColumn.text === email) {
          // Determine artist type based on board
          const artistType = board.name.includes('MUA') ? 'MUA' : 'HS'
          
          // Get tier from column values
          const tierColumn = item.column_values.find((col: any) => 
            col.id === 'tier'
          )
          
          const tier = tierColumn?.text || 'FRESH'
          
          return {
            itemId: item.id,
            email: email,
            name: item.name,
            type: artistType as 'MUA' | 'HS',
            tier: tier as 'FOUNDER' | 'RESIDENT' | 'FRESH',
            board: board.name,
            active: true
          }
        }
      }
    }

    return null
  } catch (error) {
    console.error('Failed to find artist by email:', error)
    return null
  }
}

export async function getClientFromMonday(itemId: string): Promise<MondayClient | null> {
  const query = `
    query GetClientItem($itemId: ID!) {
      items(ids: [$itemId]) {
        id
        name
        column_values {
          id
          text
          value
        }
      }
    }
  `

  try {
    const service = new MondayService()
    const data = await service.makeRequest(query, { itemId })
    const item = data.items[0]

    if (!item) {
      return null
    }

    // Extract column values
    const columnValues = item.column_values || []
    
    // Find specific columns by ID or title
    const getColumnValue = (columnId: string, fallbackTitle?: string) => {
      const column = columnValues.find((col: any) => 
        col.id === columnId || 
        (fallbackTitle && col.title.toLowerCase().includes(fallbackTitle.toLowerCase()))
      )
      return column?.text || null
    }

    const getColumnValueParsed = (columnId: string, fallbackTitle?: string) => {
      const column = columnValues.find((col: any) => 
        col.id === columnId || 
        (fallbackTitle && col.title.toLowerCase().includes(fallbackTitle.toLowerCase()))
      )
      
      if (column?.value) {
        try {
          return JSON.parse(column.value)
        } catch {
          return column.text || null
        }
      }
      return column?.text || null
    }

    // Map Monday.com columns to our client structure
    const mStatusColumnId = process.env.MONDAY_MSTATUS_COLUMN_ID
    const hStatusColumnId = process.env.MONDAY_HSTATUS_COLUMN_ID
    const chosenMuaColumnId = process.env.MONDAY_CHOSEN_MUA_COLUMN_ID
    const chosenHsColumnId = process.env.MONDAY_CHOSEN_HS_COLUMN_ID

    return {
      mondayItemId: item.id,
      name: item.name,
      email: getColumnValue('email4', 'email'),
      phone: getColumnValue('phone', 'phone'),
      eventDate: getColumnValue('date6', 'wedding date'),
      beautyVenue: getColumnValue('location', 'beauty venue') || getColumnValue('text', 'venue'),
      observations: getColumnValue('long_text', 'observations') || getColumnValue('text0', 'notes'),
      mStatus: mStatusColumnId ? getColumnValue(mStatusColumnId, 'mstatus') : null,
      hStatus: hStatusColumnId ? getColumnValue(hStatusColumnId, 'hstatus') : null,
      chosenMua: chosenMuaColumnId ? getColumnValueParsed(chosenMuaColumnId, 'chosen mua') : null,
      chosenHs: chosenHsColumnId ? getColumnValueParsed(chosenHsColumnId, 'chosen hs') : null,
    }
  } catch (error) {
    console.error('Failed to get client from Monday:', error)
    return null
  }
}

export async function getArtistByMondayId(itemId: string): Promise<MondayArtist | null> {
  // Implementation would query Monday.com for artist data
  // This is a placeholder - implement based on your Monday.com setup
  return null
}

export async function getAllClientsFromMonday(): Promise<MondayClient[]> {
  const query = `
    query GetBoardItems($boardId: ID!) {
      boards(ids: [$boardId]) {
        items_page(limit: 50) {
          items {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      }
    }
  `

  try {
    const service = new MondayService()
    const data = await service.makeRequest(query, { boardId: process.env.MONDAY_BOARD_ID })
    const board = data.boards[0]

    if (!board || !board.items_page) {
      return []
    }

    const clients: MondayClient[] = []

    for (const item of board.items_page.items) {
      const columnValues = item.column_values || []
      
      // Helper functions
      const getColumnValue = (columnId: string, fallbackTitle?: string) => {
        const column = columnValues.find((col: any) => 
          col.id === columnId || 
          (fallbackTitle && col.title.toLowerCase().includes(fallbackTitle.toLowerCase()))
        )
        return column?.text || null
      }

      const getColumnValueParsed = (columnId: string, fallbackTitle?: string) => {
        const column = columnValues.find((col: any) => 
          col.id === columnId || 
          (fallbackTitle && col.title.toLowerCase().includes(fallbackTitle.toLowerCase()))
        )
        
        if (column?.value) {
          try {
            return JSON.parse(column.value)
          } catch {
            return column.text || null
          }
        }
        return column?.text || null
      }

      // Map Monday.com columns
      const mStatusColumnId = process.env.MONDAY_MSTATUS_COLUMN_ID
      const hStatusColumnId = process.env.MONDAY_HSTATUS_COLUMN_ID
      const chosenMuaColumnId = process.env.MONDAY_CHOSEN_MUA_COLUMN_ID
      const chosenHsColumnId = process.env.MONDAY_CHOSEN_HS_COLUMN_ID

      const mStatus = mStatusColumnId ? getColumnValue(mStatusColumnId, 'mstatus') : null
      const hStatus = hStatusColumnId ? getColumnValue(hStatusColumnId, 'hstatus') : null

      // Only include clients with status of interest
      const statusesOfInterest = [
        'undecided – inquire availabilities',
        'travelling fee + inquire the artist',
        'confirmed'
      ]

      if (mStatus && statusesOfInterest.some(status => 
          mStatus.toLowerCase().includes(status.toLowerCase())
        ) || 
        hStatus && statusesOfInterest.some(status => 
          hStatus.toLowerCase().includes(status.toLowerCase())
        )) {
        
        clients.push({
          mondayItemId: item.id,
          name: item.name,
          email: getColumnValue('email4', 'email'),
          phone: getColumnValue('phone', 'phone'),
          eventDate: getColumnValue('date6', 'wedding date'),
          beautyVenue: getColumnValue('location', 'beauty venue') || getColumnValue('text', 'venue'),
          observations: getColumnValue('long_text', 'observations') || getColumnValue('text0', 'notes'),
          mStatus,
          hStatus,
          chosenMua: chosenMuaColumnId ? getColumnValueParsed(chosenMuaColumnId, 'chosen mua') : null,
          chosenHs: chosenHsColumnId ? getColumnValueParsed(chosenHsColumnId, 'chosen hs') : null,
        })
      }
    }

    return clients
  } catch (error) {
    console.error('Failed to get all clients from Monday:', error)
    return []
  }
}

export async function setEmailAutomation(itemId: string, automationType: 'Send options' | 'Send no availability'): Promise<boolean> {
  return await mondayService.setEmailAutomation(itemId, automationType)
}
