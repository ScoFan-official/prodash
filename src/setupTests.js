import '@testing-library/jest-dom'

// jsdom 可能不实现 crypto.randomUUID，测试环境统一提供确定性实现
beforeAll(() => {
  if (!globalThis.crypto?.randomUUID) {
    globalThis.crypto = {
      ...globalThis.crypto,
      randomUUID: () => `test-${Math.random().toString(36).slice(2)}`,
    }
  }
})
