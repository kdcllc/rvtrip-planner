import type { ReactNode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { VehicleSettingsModal } from './VehicleSettingsModal'
import { VehicleSettingsProvider } from '../../hooks/VehicleSettingsProvider'
import {
  useVehicleSettingsContext,
  type ProfileSyncStatus,
} from '../../hooks/useVehicleSettings'

const Probe = ({ status }: { status?: ProfileSyncStatus }) => {
  const { profile, setProfileSyncStatus } = useVehicleSettingsContext()
  return (
    <>
      <div data-testid="profile">{JSON.stringify(profile)}</div>
      {status && (
        <button type="button" onClick={() => setProfileSyncStatus(status)}>
          set-status
        </button>
      )}
    </>
  )
}

const renderModal = (probe: ReactNode = <Probe />) =>
  render(
    <VehicleSettingsProvider>
      <VehicleSettingsModal isOpen onClose={() => {}} />
      {probe}
    </VehicleSettingsProvider>
  )

const currentProfile = () =>
  JSON.parse(screen.getByTestId('profile').textContent as string)

describe('VehicleSettingsModal', () => {
  beforeEach(() => localStorage.clear())

  it('renders the four labelled fields', () => {
    renderModal()
    expect(screen.getByLabelText('RV name')).toHaveAttribute('maxlength', '80')
    expect(screen.getByLabelText('Fuel type')).toBeInTheDocument()
    expect(screen.getByLabelText('Vehicle MPG')).toBeInTheDocument()
    expect(screen.getByLabelText('Fuel tank (gallons)')).toBeInTheDocument()
  })

  it('writes name, fuel type and tank through the context', () => {
    renderModal()
    fireEvent.change(screen.getByLabelText('RV name'), { target: { value: 'Big Rig' } })
    fireEvent.change(screen.getByLabelText('Fuel type'), { target: { value: 'diesel' } })
    fireEvent.change(screen.getByLabelText('Fuel tank (gallons)'), {
      target: { value: '75' },
    })
    expect(currentProfile()).toEqual({
      name: 'Big Rig',
      fuelType: 'diesel',
      mpg: 25,
      tankGallons: 75,
    })
  })

  it('sets the tank to null when the field is emptied', () => {
    renderModal()
    const tank = screen.getByLabelText('Fuel tank (gallons)')
    fireEvent.change(tank, { target: { value: '75' } })
    fireEvent.change(tank, { target: { value: '' } })
    expect(currentProfile().tankGallons).toBeNull()
  })

  it.each([
    ['local', 'Saved on this device'],
    ['loading', 'Saving…'],
    ['synced', 'Saved to your account'],
    ['error', 'Saved on this device only — could not reach the server'],
  ] as const)('shows the %s status text', (status, text) => {
    renderModal(<Probe status={status === 'local' ? undefined : status} />)
    if (status !== 'local') fireEvent.click(screen.getByText('set-status'))
    expect(screen.getByRole('status')).toHaveTextContent(text)
  })
})
