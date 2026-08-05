import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App 外壳', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('默认停在待办页', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '效率工作台' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '待办' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByPlaceholderText(/添加待办/)).toBeInTheDocument()
  })

  test('不再显示番茄钟 Tab', () => {
    render(<App />)
    expect(screen.queryByRole('tab', { name: '番茄钟' })).not.toBeInTheDocument()
  })

  test('笔记/记账占位页可切换并显示敬请期待', async () => {
    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: '笔记' }))
    expect(screen.getByRole('heading', { name: '笔记' })).toBeInTheDocument()
    expect(screen.getByText('敬请期待')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/添加待办/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '记账' }))
    expect(screen.getByRole('heading', { name: '记账' })).toBeInTheDocument()
    expect(screen.getByText('敬请期待')).toBeInTheDocument()
  })

  test('切换回待办后数据仍在', async () => {
    render(<App />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/添加待办/), '跨页数据')
    await user.click(screen.getByRole('button', { name: '添加' }))
    await user.click(screen.getByRole('tab', { name: '笔记' }))
    await user.click(screen.getByRole('tab', { name: '待办' }))
    expect(screen.getByText('跨页数据')).toBeInTheDocument()
  })
})
