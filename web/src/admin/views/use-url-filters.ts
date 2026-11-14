import { useCallback, useEffect, useState } from 'react'

export type UrlParamCodec<T> = {
  parse: (raw: string) => T | null
  format: (value: T) => string
}

export function textParam(): UrlParamCodec<string> {
  return { parse: (raw) => raw, format: (value) => value }
}

export function choiceParam<T extends string>(allowed: readonly T[]): UrlParamCodec<T> {
  return {
    parse: (raw) => ((allowed as readonly string[]).includes(raw) ? (raw as T) : null),
    format: (value) => value,
  }
}

export function intParam(min = 1): UrlParamCodec<number> {
  return {
    parse: (raw) => {
      if (!/^\d+$/.test(raw)) return null
      const value = Number(raw)
      return Number.isSafeInteger(value) && value >= min ? value : null
    },
    format: (value) => String(value),
  }
}

function read<T>(
  key: string,
  fallback: T,
  codec: UrlParamCodec<T>,
): T {
  if (typeof location === 'undefined') return fallback
  const raw = new URLSearchParams(location.search).get(key)
  return raw === null ? fallback : (codec.parse(raw) ?? fallback)
}

export function useUrlFilter<T>(
  key: string,
  defaultValue: T,
  codec: UrlParamCodec<T>,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, defaultValue, codec))

  useEffect(() => {
    const sync = () => setValue(read(key, defaultValue, codec))
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [key, defaultValue, codec])

  const update = useCallback(
    (next: T) => {
      setValue(next)
      if (typeof location === 'undefined') return
      const params = new URLSearchParams(location.search)
      if (next === defaultValue) params.delete(key)
      else params.set(key, codec.format(next))
      const query = params.toString()
      const url = `${location.pathname}${query ? `?${query}` : ''}`
      if (url !== `${location.pathname}${location.search}`) {
        history.replaceState(history.state, '', url)
      }
    },
    [key, defaultValue, codec],
  )

  return [value, update]
}
