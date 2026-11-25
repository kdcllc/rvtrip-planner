import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VersionLabel } from './VersionLabel'

describe('VersionLabel', () => {
  it('renders the formatted version and commit', () => {
    render(<VersionLabel />)
    expect(screen.getByTestId('app-version')).toHaveTextContent('v0.0.0-test (testsha)')
  })

  it('exposes the build time as the title', () => {
    render(<VersionLabel />)
    expect(screen.getByTestId('app-version')).toHaveAttribute('title', '1970-01-01T00:00:00.000Z')
  })
})
