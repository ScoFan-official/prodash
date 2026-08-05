import { useEffect, useState } from 'react'

export function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key)
      if (stored !== null) {
        return JSON.parse(stored)
      }
    } catch {
      // 读取失败按默认值处理
    }
    return typeof defaultValue === 'function' ? defaultValue() : defaultValue
  })
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
      setSaveError(false)
    } catch {
      setSaveError(true)
    }
  }, [key, value])

  return [value, setValue, saveError]
}
