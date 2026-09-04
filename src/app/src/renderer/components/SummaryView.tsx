interface SummarySection {
  type: string
  title: string
  content?: string
  items?: any[]
}

interface Props {
  sections: SummarySection[]
}

export function SummaryView({ sections }: Props) {
  return (
    <div className="flex flex-col gap-6">
      {sections.map((section, i) => (
        <div key={i}>
          {section.type !== 'tldr' && (
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {section.title}
            </h3>
          )}
          {section.type === 'tldr' && (
            <p className="text-gray-200 text-sm leading-relaxed">{section.content}</p>
          )}
          {section.type === 'key_topics' && (
            <ul className="flex flex-col gap-2">
              {section.items?.map((item, j) => (
                <li key={j} className="text-sm text-gray-300">
                  <span className="font-medium text-gray-200">{item.topic}</span>
                  {' — '}
                  {item.detail}
                </li>
              ))}
            </ul>
          )}
          {section.type === 'decisions' && (
            <ul className="flex flex-col gap-1">
              {section.items?.map((item, j) => (
                <li key={j} className="text-sm text-gray-300">• {item}</li>
              ))}
            </ul>
          )}
          {section.type === 'action_items' && (
            <ul className="flex flex-col gap-1">
              {section.items?.map((item, j) => (
                <li key={j} className="text-sm text-gray-300">
                  <span className="font-medium text-gray-200">{item.owner}:</span>{' '}
                  {item.action}
                  {item.deadline && (
                    <span className="text-gray-500"> (by {item.deadline})</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {section.type === 'open_questions' && (
            <ul className="flex flex-col gap-1">
              {section.items?.map((item, j) => (
                <li key={j} className="text-sm text-gray-300">• {item}</li>
              ))}
            </ul>
          )}
          {section.type === 'participants' && (
            <ul className="flex flex-col gap-1">
              {section.items?.map((item, j) => (
                <li key={j} className="text-sm text-gray-300">
                  <span className="font-medium text-gray-200">{item.name}</span>
                  {' — '}
                  {item.context}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
