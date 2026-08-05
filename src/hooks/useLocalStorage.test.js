import { renderHook, act, waitFor } from '@testing-library/react'
import { useLocalStorage } from './useLocalStorage'

describe('useLocalStorage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('无存储内容时返回默认值', () => {
    const { result } = renderHook(() => useLocalStorage('k1', [1, 2]))
    expect(result.current[0]).toEqual([1, 2])
  })

  test('能读取已存在的存储值', () => {
    window.localStorage.setItem('k2', JSON.stringify({ a: 1 }))
    const { result } = renderHook(() => useLocalStorage('k2', null))
    expect(result.current[0]).toEqual({ a: 1 })
  })

  test('setValue 写入 localStorage', () => {
    const { result } = renderHook(() => useLocalStorage('k3', []))
    act(() => result.current[1]([3]))
    expect(JSON.parse(window.localStorage.getItem('k3'))).toEqual([3])
  })

  test('支持函数式更新', () => {
    const { result } = renderHook(() => useLocalStorage('k4', [1]))
    act(() => result.current[1]((prev) => [...prev, 2]))
    expect(result.current[0]).toEqual([1, 2])
    expect(JSON.parse(window.localStorage.getItem('k4'))).toEqual([1, 2])
  })

  test('defaultValue 为函数时调用它', () => {
    const { result } = renderHook(() => useLocalStorage('k5', () => 'x'))
    expect(result.current[0]).toBe('x')
  })

  test('存储内容损坏时回退默认值', () => {
    window.localStorage.setItem('k6', '{bad json')
    const { result } = renderHook(() => useLocalStorage('k6', 'fallback'))
    expect(result.current[0]).toBe('fallback')
  })

  test('写入失败时 saveError 为 true', async () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded')
      })
    const { result } = renderHook(() => useLocalStorage('k7', []))
    act(() => result.current[1]([1]))
    await waitFor(() => expect(result.current[2]).toBe(true))
    spy.mockRestore()
  })
})
