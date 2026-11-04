import { useState } from 'react'
import SystemObjectDialog from '../../components/system/SystemObjectDialog.jsx'
import { SystemBadge, systemButton, systemInput } from '../../components/system/SystemObjectList.jsx'
import SkillReleasePanel from './SkillReleasePanel.jsx'

export default function SkillReleaseDialog({ record, viewerId, busy, setBusy, onRecord, onClose, fallbackFocusRef }) {
  const [selectedVersionId, setSelectedVersionId] = useState(record.currentVersionId)
  const [dirty, setDirty] = useState(false)
  const version = record.versions.find(item => item.skillVersionId === selectedVersionId)
  const historical = selectedVersionId !== record.currentVersionId
  return <SystemObjectDialog open title="Skill 试运行与发布" description={`${version.definition.name} · ${record.skillId}`} onClose={onClose} dirty={dirty} busy={busy} fallbackFocusRef={fallbackFocusRef} footer={requestClose => <button type="button" className={systemButton} onClick={requestClose} disabled={busy}>关闭</button>}>
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink-2">查看版本
          <select className={systemInput} value={selectedVersionId} disabled={busy || dirty} title={dirty ? '请先提交或关闭并放弃操作输入，再切换版本' : undefined} onChange={event => setSelectedVersionId(event.target.value)}>
            {record.versions.map(item => <option key={item.skillVersionId} value={item.skillVersionId}>{item.versionCode}{item.skillVersionId === record.currentVersionId ? ' · 当前' : ' · 历史'}</option>)}
          </select>
        </label>
        <SystemBadge>{historical ? '历史版本，只读' : version.checkoutStatus === 'checked_out' ? '已检出' : '已检入'}</SystemBadge>
      </div>
      <SkillReleasePanel key={selectedVersionId} record={record} version={version} dirty={false} busy={busy} setBusy={setBusy} onRecord={onRecord} viewerId={viewerId} onDirtyChange={setDirty} />
    </div>
  </SystemObjectDialog>
}
