import { useCallback, useEffect, useState } from 'react'

import {
  createIndustryCategory,
  createIndustrySubcategory,
  listIndustryOptions,
  listIndustryTree,
  setIndustryCategoryStatus,
  setIndustrySubcategoryStatus,
  updateIndustryCategory,
  updateIndustrySubcategory,
} from '../api/masterData.js'

// ============================================================
// 批次 10a · 行业主数据 hook
// ============================================================
// 两个导出对应两个消费面：
//   useIndustryMasterData —— 【基础管理 → 行业】管理页（两层全量，含停用）
//   useIndustryOptions    —— 业务单据的「客户行业」下拉（只含启用项）
//
// 错误处理口径：列表加载失败要能重试且不得退化成假空集（空集在界面上
// 与「真的没有数据」长得一样）；写操作失败把后端的人话消息回给调用方。

/** 树 → 扁平行（ListPage 直接吃），一级在前、其下二级紧随。 */
export function flattenIndustryTree(tree) {
  const rows = []
  for (const category of tree ?? []) {
    rows.push({
      key: `1:${category.id}`,
      level: 1,
      id: category.id,
      name: category.name,
      status: category.status,
      sortOrder: category.sortOrder,
      categoryId: null,
      categoryName: null,
      childCount: (category.children ?? []).length,
      updatedAt: category.updatedAt,
    })
    for (const sub of category.children ?? []) {
      rows.push({
        key: `2:${sub.id}`,
        level: 2,
        id: sub.id,
        name: sub.name,
        status: sub.status,
        sortOrder: sub.sortOrder,
        categoryId: category.id,
        categoryName: category.name,
        childCount: null,
        updatedAt: sub.updatedAt,
      })
    }
  }
  return rows
}

function messageOf(err, fallback) {
  return err?.message && err.message !== '请求失败' ? err.message : fallback
}

export function useIndustryMasterData({ enabled = true } = {}) {
  const [tree, setTree] = useState([])
  const [loading, setLoading] = useState(enabled)
  const [loadError, setLoadError] = useState(null)
  const [busy, setBusy] = useState(false)

  const refetch = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const items = await listIndustryTree()
      setTree(Array.isArray(items) ? items : [])
    } catch (err) {
      // 读失败必须显式暴露，不得静默留空表
      setLoadError(err)
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) refetch()
  }, [enabled, refetch])

  /** 按层级分派的写操作封装：调用方只说「对这条行做这件事」。 */
  const run = useCallback(
    async (fn) => {
      setBusy(true)
      try {
        await fn()
        await refetch()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: messageOf(err, '操作失败') }
      } finally {
        setBusy(false)
      }
    },
    [refetch],
  )

  const createCategory = useCallback(
    (input) => run(() => createIndustryCategory(input)),
    [run],
  )
  const createSubcategory = useCallback(
    (input) => run(() => createIndustrySubcategory(input)),
    [run],
  )
  const rename = useCallback(
    (row, name) =>
      run(() =>
        row.level === 1 ? updateIndustryCategory(row.id, { name }) : updateIndustrySubcategory(row.id, { name }),
      ),
    [run],
  )
  const setStatus = useCallback(
    (row, status) =>
      run(() =>
        row.level === 1 ? setIndustryCategoryStatus(row.id, status) : setIndustrySubcategoryStatus(row.id, status),
      ),
    [run],
  )

  return {
    tree,
    rows: flattenIndustryTree(tree),
    /** 新增二级时可选的父：只列启用中的一级——停用的大类不该被继续挂新细分 */
    categoryChoices: tree.filter((c) => c.status === 'active'),
    loading,
    loadError,
    busy,
    refetch,
    createCategory,
    createSubcategory,
    rename,
    setStatus,
  }
}

/**
 * 业务单据的「客户行业」选项源。
 *
 * currentValue 用于兜住「历史值不在主数据里」的形态：库里存过 `离散制造`
 * 这类不在首批种子内的值，回显时必须仍能显示出来（可标为非标准值），
 * 不许报错、不许变空白。
 */
export function useIndustryOptions({ enabled = true, currentValue = '' } = {}) {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(enabled)
  const [loadError, setLoadError] = useState(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const items = await listIndustryOptions()
      setOptions(Array.isArray(items) ? items : [])
    } catch (err) {
      setLoadError(err)
      setOptions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) refetch()
  }, [enabled, refetch])

  const value = String(currentValue ?? '').trim()
  const known = options.some((o) => o.value === value)
  /**
   * 下拉实际渲染的选项：当前值不在启用清单里时，把它作为首项补回去。
   *
   * 库里存过 `离散制造` 这类不在首批种子内的值，也可能存过已被停用的值；
   * 本 hook 只取启用项，分不清是哪一种，故统一标为「非标准值」。
   * 无论哪种都必须保留原值：否则用户只是打开编辑看了一眼，
   * 保存时历史值就被静默改掉了。加载中不打标——那时「看不到清单」不等于「值不标准」。
   */
  const displayOptions =
    value && !known
      ? [
          {
            value,
            label: loading || loadError ? value : `${value}（非标准值）`,
            level: null,
            parentValue: null,
          },
          ...options,
        ]
      : options

  return { options, displayOptions, loading, error: loadError, refetch, isKnownValue: !value || known }
}
