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

  test('切换到番茄钟显示敬请期待', async () => {
    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: '番茄钟' }))
    expect(screen.getByText('敬请期待')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '番茄钟' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/添加待办/)).not.toBeInTheDocument()
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
