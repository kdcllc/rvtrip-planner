// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TripStop } from '../../domain/trip/types'
import type { DailyForecast, StopForecast } from '../../domain/weather/types'
import { StopWeatherForecast } from './StopWeatherForecast'

const stop: TripStop = {
  id: 'a',
  label: 'Camp A',
  address: 'Camp A address',
  startDate: '2026-06-01',
  endDate: '2026-06-04',
  status: 'ready',
}

const weekday = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
  })
const shortDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

const day = (
  date: string,
  min: number,
  max: number,
  precipChance: number | null,
  isHistorical?: boolean
): DailyForecast => ({ date, min, max, precipChance, isHistorical })

const makeForecast = (
  days: DailyForecast[],
  forecastUrl?: string
): StopForecast => ({
  stopId: 'a',
  cacheKey: 'k',
  timezone: 'America/New_York',
  forecastUrl,
  days,
  updatedAt: '2026-05-30T00:00:00Z',
})

const days3 = [
  day('2026-06-01', 67, 85, 73),
  day('2026-06-02', 60.4, 91.6, null),
  day('2026-06-03', 70, 88, 20),
]

const renderIt = (
  forecast: StopForecast | undefined,
  options: { error?: string; stop?: TripStop } = {}
) =>
  render(
    <StopWeatherForecast
      stop={options.stop ?? stop}
      forecast={forecast}
      error={options.error}
    />
  )

const items = () =>
  within(screen.getByRole('list', { name: 'Daily forecast' })).getAllByRole(
    'listitem'
  )

afterEach(() => {
  cleanup()
})

describe('StopWeatherForecast', () => {
  describe('visibility (T1)', () => {
    it.each([
      ['no start date', { ...stop, startDate: '' }],
      ['no end date', { ...stop, endDate: '' }],
      ['status other than ready', { ...stop, status: 'pending' as const }],
    ])('renders nothing with %s', (_name, badStop) => {
      const { container } = renderIt(makeForecast(days3), { stop: badStop })
      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('error and empty states', () => {
    it('T2 shows the error text and no list', () => {
      renderIt(makeForecast(days3), { error: 'Forecast failed' })
      expect(screen.getByText('Forecast failed')).toBeTruthy()
      expect(screen.queryByRole('list')).toBeNull()
    })

    it('T3 waits for coordinates with no forecast and no error', () => {
      renderIt(undefined)
      expect(screen.getByText('Waiting for map coordinates.')).toBeTruthy()
      expect(screen.queryByRole('list')).toBeNull()
    })

    it('T4 shows No forecast data. for an empty days array', () => {
      renderIt(makeForecast([]))
      expect(screen.getByText('No forecast data.')).toBeTruthy()
      expect(screen.queryByRole('list')).toBeNull()
    })
  })

  describe('strip structure', () => {
    it('T5 renders a named region with a focusable list of three days in order', () => {
      renderIt(makeForecast(days3))
      const region = screen.getByRole('region', { name: 'Weather for Camp A' })
      const list = within(region).getByRole('list', { name: 'Daily forecast' })
      expect(list.getAttribute('tabindex')).toBe('0')
      const rows = within(list).getAllByRole('listitem')
      expect(rows).toHaveLength(3)
      days3.forEach((d, i) => {
        expect(rows[i].textContent).toContain(`${weekday(d.date)}, ${shortDate(d.date)}:`)
      })
    })
  })

  describe('summary', () => {
    it('T6 summarises range and highest rain chance', () => {
      const { container } = renderIt(makeForecast(days3))
      expect(container.querySelector('.forecast-summary')?.textContent).toBe(
        '60–92°F · up to 73% rain'
      )
    })

    it('T6 omits the rain part when every precipChance is null', () => {
      const { container } = renderIt(
        makeForecast(days3.map((d) => ({ ...d, precipChance: null })))
      )
      expect(container.querySelector('.forecast-summary')?.textContent).toBe(
        '60–92°F'
      )
    })
  })

  describe('spoken sentence and historical styling', () => {
    it('T7 reads the full sentence, unknown precip and historical suffix', () => {
      renderIt(
        makeForecast([
          day('2026-06-01', 67, 85, 73),
          day('2026-06-02', 60.4, 91.6, null),
          day('2026-06-03', 70, 88, 20, true),
        ])
      )
      const sentences = items().map(
        (li) => li.querySelector('.forecast-sr-only')?.textContent
      )
      expect(sentences[0]).toBe(
        `${weekday('2026-06-01')}, ${shortDate('2026-06-01')}: high 85 degrees, low 67 degrees, 73% chance of precipitation`
      )
      expect(sentences[1]).toBe(
        `${weekday('2026-06-02')}, ${shortDate('2026-06-02')}: high 92 degrees, low 60 degrees, precipitation unknown`
      )
      expect(sentences[2]).toBe(
        `${weekday('2026-06-03')}, ${shortDate('2026-06-03')}: high 88 degrees, low 70 degrees, 20% chance of precipitation, historical average`
      )
    })

    it('T8 marks only historical days with forecast-day--historical', () => {
      renderIt(
        makeForecast([
          day('2026-06-01', 67, 85, 73, true),
          day('2026-06-02', 60, 90, 10),
          day('2026-06-03', 70, 88, 20, false),
        ])
      )
      const rows = items()
      expect(rows[0].classList.contains('forecast-day--historical')).toBe(true)
      expect(rows[1].classList.contains('forecast-day--historical')).toBe(false)
      expect(rows[2].classList.contains('forecast-day--historical')).toBe(false)
    })
  })

  describe('historical note (T9)', () => {
    it('all historical shows Historical averages', () => {
      renderIt(makeForecast(days3.map((d) => ({ ...d, isHistorical: true }))))
      expect(screen.getByText('Historical averages')).toBeTruthy()
      expect(screen.queryByText('Dashed days are historical averages')).toBeNull()
      expect(screen.queryByText(/\bavg\b/i)).toBeNull()
    })

    it('mixed shows Dashed days are historical averages', () => {
      renderIt(
        makeForecast([
          { ...days3[0], isHistorical: true },
          days3[1],
          days3[2],
        ])
      )
      expect(screen.getByText('Dashed days are historical averages')).toBeTruthy()
      expect(screen.queryByText('Historical averages')).toBeNull()
      expect(screen.queryByText(/\bavg\b/i)).toBeNull()
    })

    it('none shows neither note', () => {
      const { container } = renderIt(makeForecast(days3))
      expect(screen.queryByText('Historical averages')).toBeNull()
      expect(screen.queryByText('Dashed days are historical averages')).toBeNull()
      expect(container.querySelector('.forecast-note')).toBeNull()
      expect(container.textContent).not.toMatch(/avg/i)
    })
  })

  describe('NOAA link (T10)', () => {
    it('links to forecastUrl in a new tab', () => {
      renderIt(makeForecast(days3, 'https://forecast.weather.gov/x'))
      const link = screen.getByRole('link', {
        name: 'NOAA forecast for Camp A (opens in a new tab)',
      })
      expect(link.getAttribute('href')).toBe('https://forecast.weather.gov/x')
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noreferrer')
    })

    it('renders no link without forecastUrl', () => {
      renderIt(makeForecast(days3))
      expect(screen.queryByRole('link')).toBeNull()
    })
  })
})
