import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVersionCheck } from '../../hooks/useVersionCheck'
import { UpdateBanner } from './UpdateBanner'

vi.mock('../../hooks/useVersionCheck', () => ({ useVersionCheck: vi.fn() }))
const hook = vi.mocked(useVersionCheck)

describe('UpdateBanner', () => {
  beforeEach(() => hook.mockReset())

  it('renders nothing when no update is available', () => {
    hook.mockReturnValue({ updateAvailable: false, reload: vi.fn() })
    const { container } = render(<UpdateBanner />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the message in a status region and reloads on click', () => {
    const reload = vi.fn()
    hook.mockReturnValue({ updateAvailable: true, reload })
    render(<UpdateBanner />)
    expect(screen.getByRole('status')).toHaveTextContent('New version available')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
