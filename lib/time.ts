import { format, parseISO, isAfter, isBefore, addDays, startOfDay, endOfDay, toZonedTime, fromZonedTime } from 'date-fns'
import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz'

const TIMEZONE = process.env.TIMEZONE || 'Europe/Lisbon'

/**
 * Convert a date to Europe/Lisbon timezone
 */
export function toLisbonTime(date: string | Date): Date {
  const dateObj = typeof date === 'string' ? parseISO(date) : date
  return utcToZonedTime(dateObj, TIMEZONE)
}

/**
 * Convert a date from Europe/Lisbon timezone to UTC
 */
export function fromLisbonTime(date: string | Date): Date {
  const dateObj = typeof date === 'string' ? parseISO(date) : date
  return zonedTimeToUtc(dateObj, TIMEZONE)
}

/**
 * Get current time in Europe/Lisbon timezone
 */
export function nowInLisbon(): Date {
  return toLisbonTime(new Date())
}

/**
 * Format date in Europe/Lisbon timezone
 */
export function formatDate(date: string | Date, formatString: string = 'PPP'): string {
  const lisbonTime = toLisbonTime(date)
  return format(lisbonTime, formatString)
}

/**
 * Format date and time in Europe/Lisbon timezone
 */
export function formatDateTime(date: string | Date, formatString: string = 'PPP p'): string {
  const lisbonTime = toLisbonTime(date)
  return format(lisbonTime, formatString)
}

/**
 * Format time only in Europe/Lisbon timezone
 */
export function formatTime(date: string | Date, formatString: string = 'p'): string {
  const lisbonTime = toLisbonTime(date)
  return format(lisbonTime, formatString)
}

/**
 * Check if a deadline has expired (in Lisbon time)
 */
export function isExpired(deadline: string | Date): boolean {
  const deadlineInLisbon = toLisbonTime(deadline)
  const nowInLisbonTime = nowInLisbon()
  return isBefore(deadlineInLisbon, nowInLisbonTime)
}

/**
 * Check if a deadline is upcoming within specified days (in Lisbon time)
 */
export function isUpcoming(deadline: string | Date, daysAhead: number = 3): boolean {
  const deadlineInLisbon = toLisbonTime(deadline)
  const nowInLisbonTime = nowInLisbon()
  const futureDate = addDays(nowInLisbonTime, daysAhead)
  return isAfter(deadlineInLisbon, nowInLisbonTime) && isBefore(deadlineInLisbon, futureDate)
}

/**
 * Get days until deadline (in Lisbon time)
 */
export function getDaysUntilDeadline(deadline: string | Date): number {
  const deadlineInLisbon = toLisbonTime(deadline)
  const today = startOfDay(nowInLisbon())
  const deadlineStart = startOfDay(deadlineInLisbon)
  
  const diffTime = deadlineStart.getTime() - today.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * Get deadline status based on Lisbon time
 */
export function getDeadlineStatus(deadline: string | Date): 'expired' | 'urgent' | 'upcoming' | 'future' {
  if (isExpired(deadline)) {
    return 'expired'
  }
  
  const daysUntil = getDaysUntilDeadline(deadline)
  
  if (daysUntil <= 1) {
    return 'urgent'
  } else if (daysUntil <= 7) {
    return 'upcoming'
  } else {
    return 'future'
  }
}

/**
 * Create date range in Lisbon time
 */
export function createDateRange(start: string | Date, end: string | Date) {
  const startInLisbon = toLisbonTime(start)
  const endInLisbon = toLisbonTime(end)
  
  return {
    start: startOfDay(startInLisbon),
    end: endOfDay(endInLisbon),
  }
}

/**
 * Compare two dates in Lisbon time
 */
export function compareDatesInLisbon(date1: string | Date, date2: string | Date): number {
  const date1InLisbon = toLisbonTime(date1)
  const date2InLisbon = toLisbonTime(date2)
  
  if (date1InLisbon < date2InLisbon) return -1
  if (date1InLisbon > date2InLisbon) return 1
  return 0
}

/**
 * Get start of day in Lisbon time
 */
export function startOfDayInLisbon(date?: string | Date): Date {
  const dateToUse = date ? toLisbonTime(date) : nowInLisbon()
  return startOfDay(dateToUse)
}

/**
 * Get end of day in Lisbon time
 */
export function endOfDayInLisbon(date?: string | Date): Date {
  const dateToUse = date ? toLisbonTime(date) : nowInLisbon()
  return endOfDay(dateToUse)
}
