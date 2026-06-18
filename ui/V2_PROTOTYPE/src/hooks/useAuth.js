import { useState } from 'react'
import { apiClient } from '../api/client.js'
import { setToken } from '../api/auth.js'
import { unwrap } from '../api/utils.js'

function getDetail(error, field) {
  return Array.isArray(error?.details)
    ? error.details.find((item) => item?.field === field)
    : null
}

function getLoginErrorMessage(error) {
  const credentialDetail = getDetail(error, 'username/password')
  if (credentialDetail?.reason === 'required') return '请输入用户名和密码'
  if (credentialDetail?.reason === 'invalid_credentials') return '账号或密码错误，请重新输入'

  const userDetail = getDetail(error, 'user')
  if (userDetail?.reason === 'disabled') return '账号已被禁用，请联系管理员'

  return error?.message || '登录失败，请稍后重试'
}

function getRegisterErrorMessage(error) {
  const inviteDetail = getDetail(error, 'inviteCode')
  if (inviteDetail?.reason === 'required') return '请输入邀请码'
  if (inviteDetail?.reason === 'invalid_invite_code') return '邀请码无效或已使用'

  const usernameDetail = getDetail(error, 'username')
  if (usernameDetail?.reason === 'min_length_3') return '用户名至少需要 3 个字符'
  if (usernameDetail?.reason === 'already_exists') return '用户名已存在'

  const passwordDetail = getDetail(error, 'password')
  if (passwordDetail?.reason === 'min_length_8') return '密码至少需要 8 位'

  return error?.message || '请求失败，请稍后重试'
}

function extractToken(payload) {
  const data = unwrap(payload) || {}
  return data.token || data.accessToken || payload?.token || payload?.accessToken || ''
}

export default function useAuth({ enabled = true } = {}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const login = async (username, password, rememberMe = false) => {
    if (!enabled) return { success: false, error: '登录暂不可用' }

    setLoading(true)
    setError(null)
    try {
      const payload = await apiClient.post('/auth/login', { username, password, rememberMe })
      const token = extractToken(payload)
      if (!token) throw new Error('登录成功但未返回 token')
      setToken(token, { rememberMe })
      window.location.href = '/'
      return { success: true, error: null }
    } catch (err) {
      const message = getLoginErrorMessage(err)
      setError(message)
      return { success: false, error: message }
    } finally {
      setLoading(false)
    }
  }

  const register = async (username, password, email, inviteCode) => {
    if (!enabled) return { success: false, error: '注册暂不可用' }

    setLoading(true)
    setError(null)
    try {
      await apiClient.post('/auth/register', { username, password, email, inviteCode })
      return { success: true, error: null }
    } catch (err) {
      const message = getRegisterErrorMessage(err)
      setError(message)
      return { success: false, error: message }
    } finally {
      setLoading(false)
    }
  }

  return { login, register, loading, error }
}
