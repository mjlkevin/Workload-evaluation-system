import { Link } from 'react-router-dom'

/**
 * 消息内动作链接（如「查看评估草稿」「返回实施评估列表」）。
 */
export default function DraftLinker({ actions }) {
  if (!actions?.length) return null
  return (
    <div className="mt-2.5 flex flex-wrap gap-2">
      {actions.map((action) => (
        <Link
          key={action.label}
          className={action.primary ? 'btn btn-pri' : 'btn btn-out'}
          style={{ height: 30 }}
          to={action.to}
        >
          {action.label}
        </Link>
      ))}
    </div>
  )
}
