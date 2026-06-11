import type { RecordingListItem } from '../../shared/types'

export type DatePreset = 'all' | 'today' | 'week' | 'month' | 'custom'

export interface RecordingFilters {
  query: string
  speaker: string | null
  datePreset: DatePreset
  customFrom: string | null // 'YYYY-MM-DD' from <input type="date">
  customTo: string | null // 'YYYY-MM-DD'
}

export const emptyFilters: RecordingFilters = {
  query: '',
  speaker: null,
  datePreset: 'all',
  customFrom: null,
  customTo: null,
}

export function filtersActive(filters: RecordingFilters): boolean {
  return filters.query.trim() !== '' || filters.speaker !== null || filters.datePreset !== 'all'
}

export function getSpeakerOptions(recordings: RecordingListItem[]): string[] {
  const names = new Set<string>()
  for (const recording of recordings) {
    for (const participant of recording.participants) {
      if (participant.trim()) names.add(participant)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Monday-start calendar week
function startOfWeek(d: Date): Date {
  const day = startOfDay(d)
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  return day
}

function parseRecordingDate(value: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

// Parses 'YYYY-MM-DD' as local midnight (new Date('YYYY-MM-DD') would parse as UTC)
function parseDateInput(value: string | null): Date | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function matchesDate(recording: RecordingListItem, filters: RecordingFilters, now: Date): boolean {
  if (filters.datePreset === 'all') return true
  const date = parseRecordingDate(recording.date)
  if (!date) return false

  switch (filters.datePreset) {
    case 'today':
      return startOfDay(date).getTime() === startOfDay(now).getTime()
    case 'week': {
      const weekStart = startOfWeek(now)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 7)
      return date >= weekStart && date < weekEnd
    }
    case 'month':
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
    case 'custom': {
      const from = parseDateInput(filters.customFrom)
      const to = parseDateInput(filters.customTo)
      if (from && date < from) return false
      if (to) {
        const toEnd = new Date(to)
        toEnd.setDate(to.getDate() + 1)
        if (date >= toEnd) return false
      }
      return true
    }
  }
}

function matchesQuery(recording: RecordingListItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (recording.title.toLowerCase().includes(q)) return true
  return recording.participants.some(p => p.toLowerCase().includes(q))
}

function matchesSpeaker(recording: RecordingListItem, speaker: string | null): boolean {
  if (speaker === null) return true
  return recording.participants.includes(speaker)
}

export function filterRecordings(
  recordings: RecordingListItem[],
  filters: RecordingFilters,
  now: Date = new Date()
): RecordingListItem[] {
  return recordings.filter(
    r => matchesQuery(r, filters.query) && matchesSpeaker(r, filters.speaker) && matchesDate(r, filters, now)
  )
}
