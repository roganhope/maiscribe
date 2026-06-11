import type { DatePreset, RecordingFilters } from '../utils/recordingFilters'

interface Props {
  filters: RecordingFilters
  speakerOptions: string[]
  isActive: boolean
  onQueryChange: (query: string) => void
  onSpeakerChange: (speaker: string | null) => void
  onDatePresetChange: (preset: DatePreset) => void
  onCustomRangeChange: (from: string | null, to: string | null) => void
  onClear: () => void
}

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
]

export function RecordingFilterBar({
  filters,
  speakerOptions,
  isActive,
  onQueryChange,
  onSpeakerChange,
  onDatePresetChange,
  onCustomRangeChange,
  onClear,
}: Props) {
  return (
    <div className="p-3 border-b border-gray-700 flex flex-col gap-2">
      <input
        type="text"
        value={filters.query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search recordings…"
        className="w-full bg-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:ring-1 focus:ring-accent-400"
      />
      <div className="flex gap-2">
        <select
          value={filters.speaker ?? ''}
          onChange={(e) => onSpeakerChange(e.target.value || null)}
          className="flex-1 min-w-0 bg-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none"
        >
          <option value="">All speakers</option>
          {speakerOptions.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          value={filters.datePreset}
          onChange={(e) => onDatePresetChange(e.target.value as DatePreset)}
          className="flex-1 min-w-0 bg-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none"
        >
          {DATE_PRESETS.map(preset => (
            <option key={preset.value} value={preset.value}>{preset.label}</option>
          ))}
        </select>
      </div>
      {filters.datePreset === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filters.customFrom ?? ''}
            onChange={(e) => onCustomRangeChange(e.target.value || null, filters.customTo)}
            className="flex-1 min-w-0 bg-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none"
          />
          <span className="text-xs text-gray-500">to</span>
          <input
            type="date"
            value={filters.customTo ?? ''}
            onChange={(e) => onCustomRangeChange(filters.customFrom, e.target.value || null)}
            className="flex-1 min-w-0 bg-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none"
          />
        </div>
      )}
      {isActive && (
        <button
          onClick={onClear}
          className="self-start text-xs text-gray-400 hover:text-gray-200"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
