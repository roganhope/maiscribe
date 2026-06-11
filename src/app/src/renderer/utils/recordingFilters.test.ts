import { describe, it, expect } from 'vitest'
import type { RecordingListItem } from '../../shared/types'
import {
  emptyFilters,
  filterRecordings,
  filtersActive,
  getSpeakerOptions,
  type RecordingFilters,
} from './recordingFilters'

function rec(overrides: Partial<RecordingListItem> = {}): RecordingListItem {
  return {
    id: 'rec_1',
    folderPath: '/outbox/rec_1',
    title: 'Weekly sync',
    date: '2026-06-10T14:00:00',
    participants: ['Sarah', 'Tom'],
    durationMinutes: 30,
    recordingType: 'meeting',
    hasAudio: true,
    ...overrides,
  }
}

function filters(overrides: Partial<RecordingFilters> = {}): RecordingFilters {
  return { ...emptyFilters, ...overrides }
}

// Thursday, June 11 2026, noon local time. Monday of that week is June 8.
const NOW = new Date(2026, 5, 11, 12, 0, 0)

describe('filterRecordings', () => {
  it('passes everything through with empty filters', () => {
    const recordings = [rec({ id: 'a' }), rec({ id: 'b', date: '' })]
    expect(filterRecordings(recordings, emptyFilters, NOW)).toEqual(recordings)
  })

  describe('text query', () => {
    it('matches title case-insensitively as substring', () => {
      const recordings = [rec({ id: 'a', title: 'Weekly Sync' }), rec({ id: 'b', title: 'Standup' })]
      const result = filterRecordings(recordings, filters({ query: 'weekly' }), NOW)
      expect(result.map(r => r.id)).toEqual(['a'])
    })

    it('matches a participant name', () => {
      const recordings = [
        rec({ id: 'a', title: 'Standup', participants: ['Sarah'] }),
        rec({ id: 'b', title: 'Standup', participants: ['Tom'] }),
      ]
      const result = filterRecordings(recordings, filters({ query: 'sar' }), NOW)
      expect(result.map(r => r.id)).toEqual(['a'])
    })

    it('matches by title when participants are empty', () => {
      const recordings = [rec({ id: 'a', title: 'Solo memo', participants: [] })]
      const result = filterRecordings(recordings, filters({ query: 'memo' }), NOW)
      expect(result.map(r => r.id)).toEqual(['a'])
    })

    it('excludes non-matching recordings', () => {
      const recordings = [rec({ id: 'a', title: 'Standup', participants: ['Tom'] })]
      expect(filterRecordings(recordings, filters({ query: 'xyz' }), NOW)).toEqual([])
    })

    it('ignores surrounding whitespace in the query', () => {
      const recordings = [rec({ id: 'a', title: 'Weekly sync' })]
      const result = filterRecordings(recordings, filters({ query: '  weekly  ' }), NOW)
      expect(result.map(r => r.id)).toEqual(['a'])
    })
  })

  describe('speaker filter', () => {
    it('exact-matches a participant', () => {
      const recordings = [
        rec({ id: 'a', participants: ['Sarah', 'Tom'] }),
        rec({ id: 'b', participants: ['Tom'] }),
      ]
      const result = filterRecordings(recordings, filters({ speaker: 'Sarah' }), NOW)
      expect(result.map(r => r.id)).toEqual(['a'])
    })

    it('does not substring-match participant names', () => {
      const recordings = [rec({ id: 'a', participants: ['Sarah'] })]
      expect(filterRecordings(recordings, filters({ speaker: 'Sar' }), NOW)).toEqual([])
    })

    it('excludes recordings with empty participants when a speaker is set', () => {
      const recordings = [rec({ id: 'a', participants: [] })]
      expect(filterRecordings(recordings, filters({ speaker: 'Sarah' }), NOW)).toEqual([])
    })
  })

  describe('date presets', () => {
    it('today: includes start and end of today, excludes yesterday and tomorrow', () => {
      const recordings = [
        rec({ id: 'start', date: '2026-06-11T00:00:00' }),
        rec({ id: 'end', date: '2026-06-11T23:59:59' }),
        rec({ id: 'yesterday', date: '2026-06-10T23:59:59' }),
        rec({ id: 'tomorrow', date: '2026-06-12T00:00:00' }),
      ]
      const result = filterRecordings(recordings, filters({ datePreset: 'today' }), NOW)
      expect(result.map(r => r.id)).toEqual(['start', 'end'])
    })

    it('week: includes Monday through Sunday of the current week', () => {
      const recordings = [
        rec({ id: 'monday', date: '2026-06-08T00:00:00' }),
        rec({ id: 'sunday', date: '2026-06-14T23:59:59' }),
        rec({ id: 'lastSunday', date: '2026-06-07T23:59:59' }),
        rec({ id: 'nextMonday', date: '2026-06-15T00:00:00' }),
      ]
      const result = filterRecordings(recordings, filters({ datePreset: 'week' }), NOW)
      expect(result.map(r => r.id)).toEqual(['monday', 'sunday'])
    })

    it('month: includes first and last day of the current month only', () => {
      const recordings = [
        rec({ id: 'first', date: '2026-06-01T00:00:00' }),
        rec({ id: 'last', date: '2026-06-30T23:59:59' }),
        rec({ id: 'prevMonth', date: '2026-05-31T23:59:59' }),
        rec({ id: 'nextMonth', date: '2026-07-01T00:00:00' }),
      ]
      const result = filterRecordings(recordings, filters({ datePreset: 'month' }), NOW)
      expect(result.map(r => r.id)).toEqual(['first', 'last'])
    })
  })

  describe('custom date range', () => {
    it('from-only: includes the from day and later, excludes earlier', () => {
      const recordings = [
        rec({ id: 'before', date: '2026-06-04T23:59:59' }),
        rec({ id: 'onFrom', date: '2026-06-05T00:00:00' }),
        rec({ id: 'after', date: '2026-06-20T12:00:00' }),
      ]
      const result = filterRecordings(
        recordings,
        filters({ datePreset: 'custom', customFrom: '2026-06-05' }),
        NOW
      )
      expect(result.map(r => r.id)).toEqual(['onFrom', 'after'])
    })

    it('to-only: includes through the end of the to day, excludes later', () => {
      const recordings = [
        rec({ id: 'before', date: '2026-06-01T12:00:00' }),
        rec({ id: 'onToEnd', date: '2026-06-05T23:59:59' }),
        rec({ id: 'after', date: '2026-06-06T00:00:00' }),
      ]
      const result = filterRecordings(
        recordings,
        filters({ datePreset: 'custom', customTo: '2026-06-05' }),
        NOW
      )
      expect(result.map(r => r.id)).toEqual(['before', 'onToEnd'])
    })

    it('both ends: inclusive on both sides', () => {
      const recordings = [
        rec({ id: 'before', date: '2026-06-04T23:59:59' }),
        rec({ id: 'inside', date: '2026-06-07T12:00:00' }),
        rec({ id: 'onTo', date: '2026-06-10T23:59:59' }),
        rec({ id: 'after', date: '2026-06-11T00:00:00' }),
      ]
      const result = filterRecordings(
        recordings,
        filters({ datePreset: 'custom', customFrom: '2026-06-05', customTo: '2026-06-10' }),
        NOW
      )
      expect(result.map(r => r.id)).toEqual(['inside', 'onTo'])
    })

    it('inverted range (from > to) matches nothing', () => {
      const recordings = [rec({ id: 'a', date: '2026-06-07T12:00:00' })]
      const result = filterRecordings(
        recordings,
        filters({ datePreset: 'custom', customFrom: '2026-06-10', customTo: '2026-06-01' }),
        NOW
      )
      expect(result).toEqual([])
    })

    it('custom with both ends blank matches everything with a parseable date', () => {
      const recordings = [rec({ id: 'a' }), rec({ id: 'noDate', date: '' })]
      const result = filterRecordings(recordings, filters({ datePreset: 'custom' }), NOW)
      expect(result.map(r => r.id)).toEqual(['a'])
    })
  })

  describe('unparseable dates', () => {
    it('are excluded by any date preset other than all', () => {
      const recordings = [
        rec({ id: 'empty', date: '' }),
        rec({ id: 'garbage', date: 'not-a-date' }),
      ]
      for (const preset of ['today', 'week', 'month', 'custom'] as const) {
        expect(filterRecordings(recordings, filters({ datePreset: preset }), NOW)).toEqual([])
      }
    })

    it('are included by All time', () => {
      const recordings = [rec({ id: 'empty', date: '' })]
      const result = filterRecordings(recordings, filters({ datePreset: 'all' }), NOW)
      expect(result.map(r => r.id)).toEqual(['empty'])
    })
  })

  it('combines all criteria with AND', () => {
    const recordings = [
      rec({ id: 'match', title: 'Weekly sync', participants: ['Sarah'], date: '2026-06-11T10:00:00' }),
      rec({ id: 'wrongTitle', title: 'Standup', participants: ['Sarah'], date: '2026-06-11T10:00:00' }),
      rec({ id: 'wrongSpeaker', title: 'Weekly sync', participants: ['Tom'], date: '2026-06-11T10:00:00' }),
      rec({ id: 'wrongDate', title: 'Weekly sync', participants: ['Sarah'], date: '2026-06-01T10:00:00' }),
    ]
    const result = filterRecordings(
      recordings,
      filters({ query: 'weekly', speaker: 'Sarah', datePreset: 'today' }),
      NOW
    )
    expect(result.map(r => r.id)).toEqual(['match'])
  })
})

describe('getSpeakerOptions', () => {
  it('returns the sorted, de-duplicated union of participants', () => {
    const recordings = [
      rec({ participants: ['Tom', 'Sarah'] }),
      rec({ participants: ['Sarah', 'Alex'] }),
    ]
    expect(getSpeakerOptions(recordings)).toEqual(['Alex', 'Sarah', 'Tom'])
  })

  it('skips blank participant names', () => {
    const recordings = [rec({ participants: ['', '  ', 'Sarah'] })]
    expect(getSpeakerOptions(recordings)).toEqual(['Sarah'])
  })
})

describe('filtersActive', () => {
  it('is false for empty filters', () => {
    expect(filtersActive(emptyFilters)).toBe(false)
  })

  it('is false for a whitespace-only query', () => {
    expect(filtersActive(filters({ query: '   ' }))).toBe(false)
  })

  it('is true when a query, speaker, or date preset is set', () => {
    expect(filtersActive(filters({ query: 'x' }))).toBe(true)
    expect(filtersActive(filters({ speaker: 'Sarah' }))).toBe(true)
    expect(filtersActive(filters({ datePreset: 'today' }))).toBe(true)
    expect(filtersActive(filters({ datePreset: 'custom' }))).toBe(true)
  })
})
