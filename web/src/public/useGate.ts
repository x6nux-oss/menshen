// useGate 是查看类页面的通用两段式：GET 拿门槛凭据，点击后 POST 凭据换内容。
//
// 原文查看页与申诉详情页共用；内容接口只有在凭据验签且未过期时才返回。
import { useCallback, useEffect, useState } from 'react'
import { getJSON, postJSON, WebApiError } from './api'
import type { Gate, WebRoute } from './api'
import { errorText } from './InvalidState'

export function useGate<T>(route: WebRoute) {
  const [gate, setGate] = useState<Gate | null>(null)
  const [view, setView] = useState<T | null>(null)
  const [error, setError] = useState<string>('')
  const [revealError, setRevealError] = useState<string>('')
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(false)

  const loadGate = useCallback(async () => {
    const response = await getJSON<{ gate: Gate }>(route.path + '?json=1')
    setGate(response.gate)
  }, [route.path])

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        await loadGate()
      } catch (err) {
        if (alive) setError(errorText(err))
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [loadGate])

  const reveal = useCallback(async () => {
    if (!gate) return
    setLoading(true)
    setRevealError('')
    setExpired(false)
    try {
      const response = await postJSON<{ view: T }>(route.path, { e: gate.exp, k: gate.k })
      setView(response.view)
    } catch (err) {
      if (err instanceof WebApiError && err.status === 404) {
        try {
          await loadGate()
          setExpired(true)
          setRevealError('查看凭据已失效。已为你刷新，请再次点击「查看内容」。')
        } catch (reloadErr) {
          setExpired(false)
          setRevealError(errorText(reloadErr))
        }
      } else {
        setRevealError(errorText(err))
      }
    } finally {
      setLoading(false)
    }
  }, [gate, loadGate, route.path])

  return { gate, view, error, revealError, expired, loading, reveal }
}
