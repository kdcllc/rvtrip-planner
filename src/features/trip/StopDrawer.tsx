import { useEffect } from 'react'
import {
  StopFormFields,
  type StopFormValues,
  type StopFormValidationState,
} from './StopFormFields'
import type { SuggestionItem } from './StopFormFields'
import type { TripStop } from '../../domain/trip/types'
import type { MapBounds } from '../../services/campsiteSearch'
import './StopDrawer.css'

type StopFormFieldValue = string | boolean | { lat: number; lng: number } | null

type StopDrawerProps = {
  isOpen: boolean
  stop: TripStop | null
  mode: 'add' | 'edit'
  predictions: SuggestionItem[]
  validationState: StopFormValidationState
  error: string
  formValues: Partial<StopFormValues>
  mapBounds?: MapBounds
  onFieldChange: (field: keyof StopFormValues, value: StopFormFieldValue) => void
  onSelectPrediction: (item: SuggestionItem) => void
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
}

export const StopDrawer = ({
  isOpen,
  stop,
  mode,
  predictions,
  validationState,
  error,
  formValues,
  mapBounds,
  onFieldChange,
  onSelectPrediction,
  onSave,
  onCancel,
  onDelete,
}: StopDrawerProps) => {
  // Handle ESC key to close drawer
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onCancel()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      // Prevent body scroll when drawer is open
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onCancel])

  // Focus management
  useEffect(() => {
    if (isOpen) {
      // Focus will be managed by drawer on mount
      const timer = setTimeout(() => {
        const firstInput = document.querySelector(
          '.stop-drawer-content input'
        ) as HTMLInputElement
        if (firstInput) {
          firstInput.focus()
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const drawerTitle =
    mode === 'add'
      ? 'Add New Stop'
      : `Edit: ${stop?.label || 'Stop'}`

  return (
    <>
      {/* Backdrop */}
      <div
        className="stop-drawer-backdrop"
        onClick={onCancel}
        role="presentation"
      />

      {/* Drawer */}
      <div
        className="stop-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <div className="stop-drawer-header">
          <h2 id="drawer-title">{drawerTitle}</h2>
          <button
            className="stop-drawer-close"
            onClick={onCancel}
            aria-label="Close drawer"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="stop-drawer-content">
          <StopFormFields
            isEditing={mode === 'edit'}
            values={formValues}
            predictions={predictions}
            mapBounds={mapBounds}
            onFieldChange={onFieldChange}
            onSelectPrediction={onSelectPrediction}
            distanceFromPreviousMeters={stop?.distanceFromPreviousMeters}
            estimatedFuelCost={stop?.estimatedFuelCost}
          />

          {error && <p className="form-error">{error}</p>}
          {!error && validationState.message && (
            <p
              className={
                validationState.status === 'invalid'
                  ? 'form-error'
                  : 'muted'
              }
            >
              {validationState.message}
            </p>
          )}
          {!error && validationState.predictionStatus === 'blocked' && (
            <p className="form-error">
              Autocomplete is blocked. Check Places API, billing, and API key
              restrictions.
            </p>
          )}
          {!error && validationState.predictionStatus === 'empty' && (
            <p className="muted">No address suggestions yet.</p>
          )}
        </div>

        <div className="stop-drawer-footer">
          <div className="footer-actions-left">
            {mode === 'edit' && onDelete && (
              <button
                className="danger"
                type="button"
                onClick={onDelete}
                aria-label="Delete stop"
              >
                Delete
              </button>
            )}
          </div>
          <div className="footer-actions-right">
            <button
              className="ghost"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="primary"
              type="button"
              onClick={onSave}
            >
              {mode === 'add' ? 'Add Stop' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
