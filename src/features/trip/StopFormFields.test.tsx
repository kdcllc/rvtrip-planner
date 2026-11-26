import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StopFormFields, type StopFormValues } from './StopFormFields'
import { STOP_NOTE_MAX_LENGTH } from '../../domain/trip/stopFields'

const renderFields = (
  values: Partial<StopFormValues> = {},
  props: { isEditing?: boolean; onFieldChange?: () => void } = {},
) => {
  const onFieldChange = props.onFieldChange ?? vi.fn()
  return render(
    <StopFormFields
      isEditing={props.isEditing}
      values={values}
      predictions={[]}
      onFieldChange={onFieldChange}
      onSelectPrediction={vi.fn()}
      onGenerateSourceUrl={vi.fn()}
    />,
  )
}

const section = (title: string) => {
  const summary = screen.getByText(title, { selector: '.form-section-title' })
  return summary.closest('details') as HTMLDetailsElement
}

describe('StopFormFields sections', () => {
  it('add mode shows the core inputs and collapsed Stay and Notes, without Travel & costs', () => {
    renderFields()
    expect(screen.getByLabelText(/^Address/)).toBeInTheDocument()
    expect(screen.getByLabelText('Stop title')).toBeInTheDocument()
    expect(screen.getByLabelText('Arrival')).toBeInTheDocument()
    expect(screen.getByLabelText('Departure')).toBeInTheDocument()
    expect(section('Stay').open).toBe(false)
    expect(section('Notes').open).toBe(false)
    expect(screen.queryByText('Travel & costs')).not.toBeInTheDocument()
  })

  it('edit mode with an empty stop shows Travel & costs', () => {
    renderFields({}, { isEditing: true })
    expect(section('Travel & costs')).toBeInTheDocument()
  })

  it('edit mode with a note opens Notes and leaves Stay closed', () => {
    renderFields({ note: 'Gate code 1234' }, { isEditing: true })
    expect(section('Notes').open).toBe(true)
    expect(section('Stay').open).toBe(false)
  })

  it('edit mode with a nightly cost opens Stay and leaves Notes closed', () => {
    renderFields({ nightlyCost: '35' }, { isEditing: true })
    expect(section('Stay').open).toBe(true)
    expect(section('Notes').open).toBe(false)
  })

  it('edit mode with neither note nor stay data keeps both collapsed', () => {
    renderFields({}, { isEditing: true })
    expect(section('Stay').open).toBe(false)
    expect(section('Notes').open).toBe(false)
  })
})

describe('StopFormFields reservation details', () => {
  it('hides confirmation, site number and phone while unreserved', () => {
    renderFields({ reservationStatus: 'unreserved' })
    expect(screen.queryByLabelText('Confirmation number')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Site number')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Contact phone')).not.toBeInTheDocument()
  })

  it('shows them when status is reserved', () => {
    renderFields({ reservationStatus: 'reserved' })
    expect(screen.getByLabelText('Confirmation number')).toBeInTheDocument()
    expect(screen.getByLabelText('Site number')).toBeInTheDocument()
    expect(screen.getByLabelText('Contact phone')).toBeInTheDocument()
  })
})

describe('StopFormFields removed fields', () => {
  it('has no legacy free-text inputs and exactly one Nightly cost input', () => {
    renderFields({}, { isEditing: true })
    expect(screen.queryByLabelText('Fees / requirements')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Amenities / notes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Reservation note')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Nightly cost')).toHaveLength(1)
  })
})

describe('StopFormFields notes', () => {
  it('limits the textarea to STOP_NOTE_MAX_LENGTH and shows the current length', () => {
    renderFields({ note: 'abc' })
    const textarea = screen.getByLabelText('Note')
    expect(textarea).toHaveAttribute('maxlength', String(STOP_NOTE_MAX_LENGTH))
    expect(screen.getByText(`3/${STOP_NOTE_MAX_LENGTH}`)).toBeInTheDocument()
  })

  it('truncates over-long input passed to onFieldChange', () => {
    const onFieldChange = vi.fn()
    renderFields({}, { onFieldChange })
    const textarea = screen.getByLabelText('Note')
    // fireEvent-style change bypasses maxlength, so the handler must slice
    const long = 'x'.repeat(STOP_NOTE_MAX_LENGTH + 25)
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, long)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    expect(onFieldChange).toHaveBeenCalledWith('note', 'x'.repeat(STOP_NOTE_MAX_LENGTH))
  })

  it('announces the remaining characters only near the limit', () => {
    const { unmount } = renderFields({ note: 'x'.repeat(STOP_NOTE_MAX_LENGTH - 10) })
    expect(screen.getByText('10 characters left.')).toBeInTheDocument()
    unmount()
    renderFields({ note: 'short' })
    expect(screen.queryByText(/characters left/)).not.toBeInTheDocument()
  })
})

describe('StopFormFields accessibility', () => {
  it('marks the address input as required', () => {
    renderFields()
    expect(screen.getByLabelText(/^Address/)).toHaveAttribute('aria-required', 'true')
  })

  it('gives every input, select and textarea an accessible name', () => {
    const { container } = renderFields(
      { reservationStatus: 'reserved', sourceSiteType: 'Campground' },
      { isEditing: true },
    )
    const controls = container.querySelectorAll('input, select, textarea')
    expect(controls.length).toBeGreaterThan(10)
    controls.forEach((control) => {
      const name = control.getAttribute('name')
      const labelled = (control as HTMLInputElement).labels?.length ?? 0
      expect(labelled, `control "${name}" has no label`).toBeGreaterThan(0)
    })
  })
})

describe('StopFormFields title helper', () => {
  it('describes the title input with the helper text in add mode', () => {
    renderFields()
    const input = screen.getByLabelText('Stop title')
    expect(input).toHaveAccessibleDescription('Optional. Filled in from the address if left blank.')
  })

  it('hides the helper when the starting point is on', () => {
    renderFields({ isStartPoint: true })
    expect(screen.queryByText(/Filled in from the address/)).not.toBeInTheDocument()
  })
})
