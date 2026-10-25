import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { SYSTEM_MANAGEMENT_GROUPS, getSystemManagementSectionsByGroup } from '../../config/systemManagementSections.js'

const focusClass = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

/** Two route-driven tab levels. Each level has one Tab stop and wraps with arrow keys. */
export default function SystemManagementNav({ activeSection, ruleCount }) {
  const navigate = useNavigate()
  const groupRefs = useRef([])
  const sectionRefs = useRef([])
  const groups = SYSTEM_MANAGEMENT_GROUPS
  const sections = getSystemManagementSectionsByGroup(activeSection.groupId)

  function onTabKeyDown(event, index, items, refs, routeOf) {
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    refs.current[next]?.focus()
    navigate(routeOf(items[next]))
  }

  const groupRoute = (group) => getSystemManagementSectionsByGroup(group.id)[0].route
  const sectionRoute = (section) => section.route

  return (
    <div className="min-w-0 rounded-lg border border-solid border-line bg-surface">
      <div className="overflow-x-auto px-3 pt-3 sm:px-4">
        <div className="inline-flex min-w-max gap-1 rounded-md bg-bg-soft p-1" role="tablist" aria-label="系统管理分组">
          {groups.map((group, index) => {
            const selected = group.id === activeSection.groupId
            return (
              <button
                key={group.id}
                ref={(node) => { groupRefs.current[index] = node }}
                type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1}
                className={`inline-flex h-9 appearance-none items-center justify-center whitespace-nowrap rounded-sm border border-solid px-4 font-sans text-sm leading-5 cursor-pointer ${focusClass} ${selected ? 'border-line bg-surface font-semibold text-brand-ink' : 'border-transparent bg-transparent font-medium text-ink-2 hover:bg-surface'}`}
                onClick={() => { if (!selected) navigate(groupRoute(group)) }}
                onKeyDown={(event) => onTabKeyDown(event, index, groups, groupRefs, groupRoute)}
              >{group.label}</button>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex min-w-0 gap-4 overflow-x-auto px-4 sm:gap-6" role="tablist" aria-label="系统管理配置分类">
        {sections.map((section, index) => {
          const selected = activeSection.id === section.id
          return (
            <button
              key={section.id}
              ref={(node) => { sectionRefs.current[index] = node }}
              type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1}
              className={`inline-flex h-12 shrink-0 appearance-none items-center gap-2 whitespace-nowrap rounded-none border-0 border-b-2 border-solid bg-transparent px-1 font-sans text-sm leading-5 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-brand ${selected ? 'border-brand font-semibold text-brand-ink' : 'border-transparent font-medium text-ink-2 hover:border-line-2 hover:text-ink'}`}
              onClick={() => { if (!selected) navigate(section.route) }}
              onKeyDown={(event) => onTabKeyDown(event, index, sections, sectionRefs, sectionRoute)}
            >
              {section.label}
              {section.id === 'rules' && ruleCount > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-bg-soft px-1 font-mono text-xs font-medium tabular-nums text-ink-2">{ruleCount}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
