import { describe, it, expect } from 'vitest'
import { summaryToText, transcriptToText } from './copyText'

describe('summaryToText', () => {
  it('omits the TL;DR heading so the summary reads as a lead paragraph', () => {
    const text = summaryToText([
      { type: 'tldr', title: 'TL;DR', content: 'Alice and Bob agreed to ship Friday.' },
    ])
    expect(text).toBe('Alice and Bob agreed to ship Friday.')
  })

  it('keeps headings for every other section type', () => {
    const text = summaryToText([
      { type: 'tldr', title: 'TL;DR', content: 'Short chat.' },
      {
        type: 'key_topics',
        title: 'Key Topics',
        items: [{ topic: 'Timeline', detail: 'Slipped a week' }],
      },
      { type: 'decisions', title: 'Decisions', items: ['Ship on Friday'] },
      {
        type: 'action_items',
        title: 'Action Items',
        items: [
          { owner: 'Alice', action: 'Write the changelog', deadline: 'Thursday' },
          { owner: 'Bob', action: 'Cut the release', deadline: null },
        ],
      },
      {
        type: 'participants',
        title: 'Participants',
        items: [{ name: 'Alice', context: 'engineer' }],
      },
    ])

    expect(text).toBe(
      [
        'Short chat.',
        '',
        'Key Topics',
        '- Timeline — Slipped a week',
        '',
        'Decisions',
        '- Ship on Friday',
        '',
        'Action Items',
        '- Alice: Write the changelog (by Thursday)',
        '- Bob: Cut the release',
        '',
        'Participants',
        '- Alice — engineer',
      ].join('\n'),
    )
  })

  it('returns an empty string when there are no sections', () => {
    expect(summaryToText([])).toBe('')
  })
})

describe('transcriptToText', () => {
  const segments = [
    { start: 0, end: 4, text: 'Hello there.', speaker: 'SPEAKER_00' },
    { start: 4, end: 8, text: ' Ready to start?', speaker: 'SPEAKER_00' },
    { start: 65, end: 70, text: 'Yes, go ahead.', speaker: 'SPEAKER_01' },
  ]

  it('collapses consecutive segments from the same speaker', () => {
    expect(transcriptToText(segments)).toBe(
      '[0:00] SPEAKER_00: Hello there. Ready to start?\n\n[1:05] SPEAKER_01: Yes, go ahead.',
    )
  })

  it('resolves enrolled speaker names when a map is supplied', () => {
    const text = transcriptToText(
      segments,
      { SPEAKER_00: 'spk_a', SPEAKER_01: 'spk_b' },
      { spk_a: 'Alice', spk_b: null },
    )
    expect(text).toContain('[0:00] Alice: Hello there. Ready to start?')
    expect(text).toContain('[1:05] SPEAKER_01: Yes, go ahead.')
  })

  it('skips blank segments', () => {
    expect(transcriptToText([{ start: 0, end: 1, text: '   ', speaker: 'SPEAKER_00' }])).toBe('')
  })
})
