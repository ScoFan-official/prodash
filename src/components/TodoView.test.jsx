import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TodoView from './TodoView'

async function addTodo(text) {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/添加待办/), text)
  await user.click(screen.getByRole('button', { name: '添加' }))
  return user
}

describe('TodoView 列表视图', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('添加待办后出现在列表中', async () => {
    render(<TodoView />)
    await addTodo('去超市买菜')
    expect(screen.getByText('去超市买菜')).toBeInTheDocument()
  })

  test('空输入不产生待办', async () => {
    render(<TodoView />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  test('勾选待办切换为已完成', async () => {
    render(<TodoView />)
    const user = await addTodo('写周报')
    await user.click(screen.getByRole('checkbox', { name: '标记完成' }))
    expect(screen.getByRole('checkbox', { name: '标记完成' })).toBeChecked()
  })

  test('删除待办后从列表消失', async () => {
    render(<TodoView />)
    const user = await addTodo('待删除')
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.queryByText('待删除')).not.toBeInTheDocument()
  })

  test('写入失败时显示保存失败提示', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    render(<TodoView />)
    await addTodo('会失败的任务')
    expect(await screen.findByText(/保存失败/)).toBeInTheDocument()
    vi.restoreAllMocks()
  })
})
