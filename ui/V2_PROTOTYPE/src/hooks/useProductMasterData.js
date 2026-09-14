import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  createProductAssignment,
  createProductLine,
  createProductModule,
  createProductSku,
  listProductMasterDataOptions,
  listProductMasterDataTree,
  setProductAssignmentStatus,
  setProductLineStatus,
  setProductModuleStatus,
  setProductSkuStatus,
  updateProductAssignment,
} from '../api/masterData.js'

// ============================================================
// 批次 10b · 产品主数据 hook
// ============================================================

function messageOf(err, fallback) {
  return err?.message && err.message !== '请求失败' ? err.message : fallback
}

function flattenTree(tree) {
  const rows = []
  for (const product of tree ?? []) {
    for (const sku of product.children ?? []) {
      for (const assignment of sku.children ?? []) {
        rows.push({
          ...assignment,
          productName: product.name,
          skuName: sku.name,
          productStatus: product.status,
          skuStatus: sku.status,
        })
      }
    }
  }
  return rows
}

export function useProductMasterData({ enabled = true } = {}) {
  const [tree, setTree] = useState([])
  const [options, setOptions] = useState({ products: [], skus: [], modules: [] })
  const [loading, setLoading] = useState(enabled)
  const [loadError, setLoadError] = useState(null)
  const [busy, setBusy] = useState(false)

  const refetch = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [items, opts] = await Promise.all([listProductMasterDataTree(), listProductMasterDataOptions()])
      setTree(Array.isArray(items) ? items : [])
      setOptions({
        products: Array.isArray(opts?.products) ? opts.products : [],
        skus: Array.isArray(opts?.skus) ? opts.skus : [],
        modules: Array.isArray(opts?.modules) ? opts.modules : [],
      })
    } catch (err) {
      setLoadError(err)
      setTree([])
      setOptions({ products: [], skus: [], modules: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) refetch()
  }, [enabled, refetch])

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

  const createEntity = useCallback(
    (type, input) => run(async () => {
      if (type === 'line') await createProductLine(input)
      if (type === 'sku') await createProductSku(input)
      if (type === 'module') await createProductModule(input)
    }),
    [run],
  )

  const createAssignment = useCallback(
    (input) => run(() => createProductAssignment(input)),
    [run],
  )

  const updateAssignment = useCallback(
    (id, patch) => run(() => updateProductAssignment(id, patch)),
    [run],
  )

  const setStatus = useCallback(
    (row, status) => run(() => setProductAssignmentStatus(row.id, status)),
    [run],
  )

  const setEntityStatus = useCallback(
    (type, id, status) => run(async () => {
      if (type === 'line') await setProductLineStatus(id, status)
      if (type === 'sku') await setProductSkuStatus(id, status)
      if (type === 'module') await setProductModuleStatus(id, status)
    }),
    [run],
  )

  const rows = useMemo(() => flattenTree(tree), [tree])

  return {
    tree,
    rows,
    options,
    loading,
    loadError,
    busy,
    refetch,
    createEntity,
    createAssignment,
    updateAssignment,
    setStatus,
    setEntityStatus,
  }
}
