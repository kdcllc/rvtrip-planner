import { useEffect } from 'react'
import { useVehicleSettings } from '../../hooks/useVehicleSettings'
import type { GasPriceLookupResult } from '../../domain/gas/types'
import './StopDrawer.css'

type VehicleSettingsModalProps = {
  isOpen: boolean
  gasPrice?: GasPriceLookupResult
  onClose: () => void
}

export const VehicleSettingsModal = ({
  isOpen,
  gasPrice,
  onClose,
}: VehicleSettingsModalProps) => {
  const { mpg, setMpg } = useVehicleSettings()

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  // Focus management
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        const mpgInput = document.querySelector(
          '.vehicle-settings-modal-content input'
        ) as HTMLInputElement
        if (mpgInput) {
          mpgInput.focus()
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const handleMpgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    if (!isNaN(value)) {
      setMpg(value)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="stop-drawer-backdrop"
        onClick={onClose}
        role="presentation"
      />

      {/* Modal */}
      <div
        className="stop-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="stop-drawer-header">
          <h2 id="settings-modal-title">Vehicle Settings</h2>
          <button
            className="stop-drawer-close"
            onClick={onClose}
            aria-label="Close settings"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="vehicle-settings-modal-content stop-drawer-content">
          <div className="form-group">
            <label htmlFor="mpg-input">
              Miles Per Gallon (MPG)
              <input
                id="mpg-input"
                type="number"
                min="5"
                max="100"
                step="0.5"
                value={mpg}
                onChange={handleMpgChange}
                aria-label="Vehicle MPG"
              />
            </label>
            <p className="muted" style={{ fontSize: '0.9rem', marginTop: '4px' }}>
              Used to calculate estimated fuel costs for your trip.
            </p>
          </div>

          {gasPrice && (
            <div className="form-group">
              <label>Current Gas Price</label>
              <div
                style={{
                  padding: '12px',
                  backgroundColor: 'var(--color-surface-strong)',
                  borderRadius: '12px',
                }}
              >
                <p style={{ margin: '0 0 4px 0', fontWeight: 500 }}>
                  ${gasPrice.pricePerGallon.toFixed(2)} per gallon
                </p>
                <p className="muted" style={{ margin: '4px 0 0 0', fontSize: '0.85rem' }}>
                  Source: {gasPrice.source}
                </p>
                {gasPrice.error && (
                  <p className="form-error" style={{ margin: '4px 0 0 0', fontSize: '0.85rem' }}>
                    {gasPrice.error}
                  </p>
                )}
              </div>
            </div>
          )}

          {!gasPrice && (
            <div className="form-group">
              <p className="muted">
                Gas price information not available. Make sure your trip has a starting location.
              </p>
            </div>
          )}
        </div>

        <div className="stop-drawer-footer">
          <div className="footer-actions-right">
            <button className="primary" type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
