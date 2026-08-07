import '@testing-library/jest-dom'

// jsdom 未实现 ResizeObserver；Radix Checkbox 带 id 时渲染内部 bubble input，
// 依赖 @radix-ui/react-use-size，缺失会导致组件挂载即抛错。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub
}

// jsdom 可能不实现 crypto.randomUUID，测试环境统一提供确定性实现
beforeAll(() => {
  if (!globalThis.crypto?.randomUUID) {
    globalThis.crypto = {
      ...globalThis.crypto,
      randomUUID: () => `test-${Math.random().toString(36).slice(2)}`,
    }
  }
})
