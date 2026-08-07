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

// jsdom 未实现 Pointer Capture API；Radix Select 的指针事件处理会调用
// hasPointerCapture / setPointerCapture / releasePointerCapture，缺失则下拉无法打开。
if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false
  }
  Element.prototype.setPointerCapture = function setPointerCapture() {}
  Element.prototype.releasePointerCapture = function releasePointerCapture() {}
}

// jsdom 未实现 scrollIntoView；Radix Select 打开下拉时会把选中项滚动到可见区。
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
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
