import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

const Counter = () => {
  const [n, setN] = useState(0)
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      count {n}
    </button>
  )
}

describe('DOM test harness', () => {
  it('renders and queries a component with jest-dom matchers', async () => {
    render(<Counter />)
    const button = screen.getByRole('button', { name: 'count 0' })
    expect(button).toBeInTheDocument()
    await userEvent.click(button)
    expect(screen.getByRole('button', { name: 'count 1' })).toBeVisible()
  })
})
