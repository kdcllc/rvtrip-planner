import type { ReactNode } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { VehicleSettingsModal } from './VehicleSettingsModal'
import { VehicleSettingsProvider } from '../../hooks/VehicleSettingsProvider'
import {
  useVehicleSettingsContext,
  type ProfileSyncStatus,
} from '../../hooks/useVehicleSettings'

const Probe = ({ status }: { status?: ProfileSyncStatus }) => {
  const { profile, garage, setProfileSyncStatus } = useVehicleSettingsContext()
  return (
    <>
      <div data-testid="garage">{JSON.stringify(garage)}</div>
      <div data-testid="profile">{JSON.stringify(profile)}</div>
      {status && (
        <button type="button" onClick={() => setProfileSyncStatus(status)}>
          set-status
        </button>
      )}
    </>
  )
}

const renderModal = (
  probe: ReactNode = <Probe />,
  props: { selectedVehicleId?: string } = {}
) =>
  render(
    <VehicleSettingsProvider>
      <VehicleSettingsModal isOpen onClose={() => {}} {...props} />
      {probe}
    </VehicleSettingsProvider>
  )

const currentProfile = () =>
  JSON.parse(screen.getByTestId('profile').textContent as string)

type SeedVehicle = {
  id: string
  name: string
  fuelType: 'gasoline' | 'diesel'
  mpg: number
  tankGallons: number | null
}

const seed = (count: number, defaultId = 'v1') => {
  const vehicles: SeedVehicle[] = Array.from({ length: count }, (_, i) => ({
    id: `v${i + 1}`,
    name: `Rig ${i + 1}`,
    fuelType: i === 1 ? 'diesel' : 'gasoline',
    mpg: i === 1 ? 10 : 25,
    tankGallons: null,
  }))
  localStorage.setItem(
    'trip-planner:vehicleGarage',
    JSON.stringify({ vehicles, defaultVehicleId: defaultId })
  )
}

const currentGarage = () =>
  JSON.parse(screen.getByTestId('garage').textContent as string)

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

  it('opens on the given vehicle', () => {
    seed(2)
    renderModal(<Probe />, { selectedVehicleId: 'v2' })
    expect(screen.getByLabelText('RV name')).toHaveValue('Rig 2')
    expect(screen.getByRole('button', { name: /Rig 2/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('falls back to the default vehicle for an unknown id', () => {
    seed(2, 'v2')
    renderModal(<Probe />, { selectedVehicleId: 'nope' })
    expect(screen.getByLabelText('RV name')).toHaveValue('Rig 2')
  })

  it('lists vehicles with summary and a Default badge', () => {
    seed(2)
    renderModal()
    const list = screen.getByRole('list', { name: 'Your vehicles' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Rig 1')
    expect(items[0]).toHaveTextContent('Gasoline · 25 MPG')
    expect(items[0]).toHaveTextContent('Default')
    expect(items[1]).toHaveTextContent('Diesel · 10 MPG')
    expect(items[1]).not.toHaveTextContent('Default')
  })

  it('switches the edited vehicle when another is picked', () => {
    seed(2)
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /Rig 2/ }))
    expect(screen.getByLabelText('RV name')).toHaveValue('Rig 2')
  })

  it('adds a vehicle, selects it, and disables Add at the maximum', () => {
    seed(9)
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Add vehicle' }))
    const garage = currentGarage()
    expect(garage.vehicles).toHaveLength(10)
    const added = garage.vehicles[9]
    expect(screen.getByLabelText('RV name')).toHaveValue(added.name)
    expect(screen.getByRole('button', { name: 'Add vehicle' })).toBeDisabled()
    expect(screen.getByText('You can keep up to 10 vehicles.')).toBeInTheDocument()
  })

  it('edits only the selected vehicle', () => {
    seed(2)
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /Rig 2/ }))
    fireEvent.change(screen.getByLabelText('RV name'), { target: { value: 'Big' } })
    const { vehicles } = currentGarage()
    expect(vehicles[0].name).toBe('Rig 1')
    expect(vehicles[1].name).toBe('Big')
  })

  it('sets the selected vehicle as default', () => {
    seed(2)
    renderModal()
    expect(screen.queryByRole('button', { name: 'Set as default' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Rig 2/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Set as default' }))
    expect(currentGarage().defaultVehicleId).toBe('v2')
    expect(screen.queryByRole('button', { name: 'Set as default' })).toBeNull()
  })

  it('confirms before deleting and can cancel', () => {
    seed(2)
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Delete vehicle' }))
    expect(
      screen.getByText(
        'Delete Rig 1? Trips that use it will switch to your default vehicle.'
      )
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Delete vehicle' })).toHaveFocus()
    expect(currentGarage().vehicles).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete vehicle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const garage = currentGarage()
    expect(garage.vehicles).toHaveLength(1)
    expect(garage.vehicles[0].id).toBe('v2')
    expect(screen.getByLabelText('RV name')).toHaveValue('Rig 2')
    expect(screen.getByRole('button', { name: /Rig 2/ })).toHaveFocus()
  })

  it('resets the selection when the dialog is closed and reopened', () => {
    seed(2)
    const tree = (open: boolean) => (
      <VehicleSettingsProvider>
        <VehicleSettingsModal isOpen={open} selectedVehicleId="v2" onClose={() => {}} />
      </VehicleSettingsProvider>
    )
    const { rerender } = render(tree(true))
    fireEvent.click(screen.getByRole('button', { name: /Rig 1/ }))
    expect(screen.getByLabelText('RV name')).toHaveValue('Rig 1')
    rerender(tree(false))
    expect(screen.queryByLabelText('RV name')).toBeNull()
    rerender(tree(true))
    expect(screen.getByLabelText('RV name')).toHaveValue('Rig 2')
  })

  it('does not allow deleting the last vehicle', () => {
    seed(1)
    renderModal()
    const del = screen.getByRole('button', { name: 'Delete vehicle' })
    expect(del).toBeDisabled()
    expect(del).toHaveAttribute('title', 'Keep at least one vehicle')
    fireEvent.click(del)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(currentGarage().vehicles).toHaveLength(1)
  })
})
