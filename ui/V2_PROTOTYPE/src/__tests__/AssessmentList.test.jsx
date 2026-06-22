import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import AssessmentList from '../pages/AssessmentList.jsx'

describe('AssessmentList', () => {
  beforeEach(() => {
    localStorage.setItem('wes_token', 'mock-token')
  })

  test('renders ai draft badge and filter', async () => {
    render(<MemoryRouter><AssessmentList /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('AI 生成项目评估草稿')).toBeInTheDocument())
    expect(screen.getByText('AI 草稿')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI 草稿' }))
    await waitFor(() => {
      expect(screen.getByText('AI 生成项目评估草稿')).toBeInTheDocument()
      expect(screen.queryByText('利民集团数字化二期')).not.toBeInTheDocument()
    })
  })
})
