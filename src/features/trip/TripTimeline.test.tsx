// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TripStop } from '../../domain/trip/types'
import { formatDateRange } from '../../utils/date'
import { TripTimeline } from './TripTimeline'

const makeStop = (
  id: string,
  label: string,
  startDate: string,
  endDate: string
): TripStop => ({ id, label, address: `${label} address`, startDate, endDate })

const stopA = makeStop('a', 'Alpha Camp', '2026-06-01', '2026-06-05') // 4 nights
const stopB = makeStop('b', 'Bravo Park', '2026-06-05', '2026-06-07') // 2 nights
const stopC = makeStop('c', 'Charlie Lot', '2026-06-07', '2026-06-08') // 1 night
const stopPass = makeStop('p', 'Pass Stop', '2026-06-08', '2026-06-08') // 0 nights
const fixture = [stopA, stopB, stopC]

const tripRange = formatDateRange('2026-06-01', '2026-06-08')
const rangeOf = (stop: TripStop) => formatDateRange(stop.startDate, stop.endDate)

const renderTimeline = (
  props: Partial<React.ComponentProps<typeof TripTimeline>> = {}
) => {
  const onStopClick = vi.fn()
  const utils = render(
    <TripTimeline
      stops={fixture}
      onStopClick={onStopClick}
      currentStopId={null}
      {...props}
    />
  )
  return { onStopClick, ...utils }
}

const stayButton = (name: RegExp | string) => screen.getByRole('button', { name })

const readoutText = (container: HTMLElement) =>
  container.querySelector('.timeline-readout')?.textContent

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TripTimeline', () => {
  describe('visibility', () => {
    it('T1 renders nothing with fewer than 2 dated stops and no actions', () => {
      const { container } = renderTimeline({ stops: [stopA] })
      expect(container).toBeEmptyDOMElement()
    })

    it('T1 ignores undated stops when counting', () => {
      const undated = makeStop('u', 'Undated', '', '')
      const { container } = renderTimeline({ stops: [stopA, undated] })
      expect(container).toBeEmptyDOMElement()
    })

    it('T2 renders only the actions with fewer than 2 dated stops', () => {
      renderTimeline({
        stops: [stopA],
        actions: <button type="button">Add stop</button>,
      })
      expect(screen.getByRole('button', { name: 'Add stop' })).toBeInTheDocument()
      expect(
        screen.queryByRole('navigation', { name: 'Trip timeline' })
      ).not.toBeInTheDocument()
    })
  })

  describe('stay buttons', () => {
    it('T3 renders a Trip timeline landmark with exactly three stay buttons', () => {
      renderTimeline()
      const nav = screen.getByRole('navigation', { name: 'Trip timeline' })
      expect(within(nav).getAllByRole('button')).toHaveLength(3)
    })

    it('T4 names each button label, date range and night count (singular for 1)', () => {
      renderTimeline()
      expect(
        screen.getByRole('button', {
          name: `Alpha Camp, ${rangeOf(stopA)}, 4 nights`,
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: `Bravo Park, ${rangeOf(stopB)}, 2 nights`,
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: `Charlie Lot, ${rangeOf(stopC)}, 1 night`,
        })
      ).toBeInTheDocument()
    })

    it('T5 marks a 0-night stop as pass-through in name and class', () => {
      renderTimeline({ stops: [...fixture, stopPass] })
      const button = stayButton(/^Pass Stop,/)
      expect(button).toHaveAccessibleName(
        `Pass Stop, ${rangeOf(stopPass)}, pass-through stop`
      )
      expect(button).toHaveClass('timeline-stay--pass-through')
      expect(stayButton(/^Alpha Camp,/)).not.toHaveClass(
        'timeline-stay--pass-through'
      )
    })

    it('T6 sets aria-current only on the current stop', () => {
      renderTimeline({ currentStopId: 'b' })
      expect(stayButton(/^Bravo Park,/)).toHaveAttribute('aria-current', 'true')
      expect(stayButton(/^Alpha Camp,/)).not.toHaveAttribute('aria-current')
      expect(stayButton(/^Charlie Lot,/)).not.toHaveAttribute('aria-current')
    })

    it('T6 sets no aria-current when currentStopId is null', () => {
      renderTimeline({ currentStopId: null })
      for (const button of screen.getAllByRole('button')) {
        expect(button).not.toHaveAttribute('aria-current')
      }
    })

    it('T7 calls onStopClick once with the clicked stop id', () => {
      const { onStopClick } = renderTimeline()
      fireEvent.click(stayButton(/^Charlie Lot,/))
      expect(onStopClick).toHaveBeenCalledTimes(1)
      expect(onStopClick).toHaveBeenCalledWith('c')
    })
  })

  describe('readout', () => {
    it('T8 shows the stop count and trip range with no active stop', () => {
      const { container } = renderTimeline()
      expect(readoutText(container)).toBe(`3 stops · ${tripRange}`)
    })

    it('T8 shows the active stop line when currentStopId is set', () => {
      const { container } = renderTimeline({ currentStopId: 'a' })
      expect(readoutText(container)).toBe(
        `Alpha Camp · ${rangeOf(stopA)} · 4 nights`
      )
    })

    it('T8 shows the hovered stop and returns to the previous line on unhover', () => {
      const { container } = renderTimeline({ currentStopId: 'a' })
      const bravo = stayButton(/^Bravo Park,/)
      fireEvent.mouseEnter(bravo)
      expect(readoutText(container)).toBe(
        `Bravo Park · ${rangeOf(stopB)} · 2 nights`
      )
      fireEvent.mouseLeave(bravo)
      expect(readoutText(container)).toBe(
        `Alpha Camp · ${rangeOf(stopA)} · 4 nights`
      )
    })

    it('T8 returns to the summary after unhover when no stop is active', () => {
      const { container } = renderTimeline()
      const bravo = stayButton(/^Bravo Park,/)
      fireEvent.mouseEnter(bravo)
      expect(readoutText(container)).toContain('Bravo Park')
      fireEvent.mouseLeave(bravo)
      expect(readoutText(container)).toBe(`3 stops · ${tripRange}`)
    })

    it('T8 shows the focused stop line on focus and reverts on blur', () => {
      const { container } = renderTimeline()
      const charlie = stayButton(/^Charlie Lot,/)
      fireEvent.focus(charlie)
      expect(readoutText(container)).toBe(
        `Charlie Lot · ${rangeOf(stopC)} · 1 night`
      )
      fireEvent.blur(charlie)
      expect(readoutText(container)).toBe(`3 stops · ${tripRange}`)
    })

    it('T8 describes a pass-through stop in the readout', () => {
      const { container } = renderTimeline({
        stops: [...fixture, stopPass],
        currentStopId: 'p',
      })
      expect(readoutText(container)).toBe(
        `Pass Stop · ${rangeOf(stopPass)} · pass-through stop`
      )
    })
  })

  describe('actions', () => {
    it('T9 renders actions inside the timeline landmark', () => {
      renderTimeline({ actions: <button type="button">Add stop</button> })
      const nav = screen.getByRole('navigation', { name: 'Trip timeline' })
      expect(
        within(nav).getByRole('button', { name: 'Add stop' })
      ).toBeInTheDocument()
    })
  })

  describe('auto-scroll', () => {
    // Active bar sits to the right of the visible container area.
    const stubRects = (container: HTMLElement) => {
      const scroller = container.querySelector<HTMLElement>('.timeline-scroll')!
      const bar = container.querySelector<HTMLElement>('[data-stop-id="c"]')!
      const rect = (left: number, width: number) =>
        ({
          left,
          right: left + width,
          width,
          top: 0,
          bottom: 0,
          height: 0,
          x: left,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect
      scroller.getBoundingClientRect = () => rect(0, 400)
      bar.getBoundingClientRect = () => rect(900, 100)
      const scrollTo = vi.fn()
      scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo
      return scrollTo
    }

    const stubMatchMedia = (matches: boolean) => {
      const matchMedia = vi.fn().mockReturnValue({ matches })
      vi.stubGlobal('matchMedia', matchMedia)
      return matchMedia
    }

    const rerenderWithCurrent = (
      rerender: (ui: React.ReactElement) => void,
      currentStopId: string | null
    ) =>
      rerender(
        <TripTimeline
          stops={fixture}
          onStopClick={vi.fn()}
          currentStopId={currentStopId}
        />
      )

    it('T10 scrolls smoothly to an off-screen active bar', () => {
      const { container, rerender } = renderTimeline()
      const scrollTo = stubRects(container)
      const matchMedia = stubMatchMedia(false)

      rerenderWithCurrent(rerender, 'c')

      expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
      expect(scrollTo).toHaveBeenCalledTimes(1)
      // centered: 900 - (400 - 100) / 2 = 750
      expect(scrollTo).toHaveBeenCalledWith({ left: 750, behavior: 'smooth' })
    })

    it('T10 uses behavior auto when reduced motion is preferred', () => {
      const { container, rerender } = renderTimeline()
      const scrollTo = stubRects(container)
      stubMatchMedia(true)

      rerenderWithCurrent(rerender, 'c')

      expect(scrollTo).toHaveBeenCalledTimes(1)
      expect(scrollTo).toHaveBeenCalledWith({ left: 750, behavior: 'auto' })
    })

    it('T10 does not scroll when the active bar is already fully visible', () => {
      const { container, rerender } = renderTimeline()
      const scrollTo = stubRects(container)
      stubMatchMedia(false)
      const bar = container.querySelector<HTMLElement>('[data-stop-id="c"]')!
      bar.getBoundingClientRect = () =>
        ({ left: 100, right: 200, width: 100 }) as DOMRect

      rerenderWithCurrent(rerender, 'c')

      expect(scrollTo).not.toHaveBeenCalled()
    })

    it('T11 does not throw when scrollTo and matchMedia are absent', () => {
      const { container, rerender } = renderTimeline()
      const scroller = container.querySelector<HTMLElement>('.timeline-scroll')!
      ;(scroller as unknown as { scrollTo: unknown }).scrollTo = undefined
      vi.stubGlobal('matchMedia', undefined)

      expect(() => rerenderWithCurrent(rerender, 'b')).not.toThrow()
      expect(stayButton(/^Bravo Park,/)).toHaveAttribute('aria-current', 'true')
    })

    it('T11 does not throw when only matchMedia is absent', () => {
      const { container, rerender } = renderTimeline()
      const scrollTo = stubRects(container)
      vi.stubGlobal('matchMedia', undefined)

      expect(() => rerenderWithCurrent(rerender, 'c')).not.toThrow()
      expect(scrollTo).not.toHaveBeenCalled()
    })
  })

  describe('date axis', () => {
    it('T12 hides the axis from assistive tech and shows marker labels', () => {
      const { container } = renderTimeline()
      const axis = container.querySelector('.timeline-axis')
      expect(axis).toHaveAttribute('aria-hidden', 'true')
      const labels = axis!.querySelectorAll('.timeline-marker-label')
      expect(labels.length).toBeGreaterThanOrEqual(1)
      expect(labels[0].textContent).toBeTruthy()
    })
  })

  describe('lanes', () => {
    const laneOf = (container: HTMLElement, id: string) =>
      container.querySelector(`[data-stop-id="${id}"]`)!.getAttribute('data-lane')
    const lanesVar = (container: HTMLElement) =>
      (container.querySelector('.timeline-track') as HTMLElement).style.getPropertyValue(
        '--timeline-lanes'
      )

    it('C9 puts consecutive stays in lane 0 with one lane', () => {
      const { container } = renderTimeline()
      for (const id of ['a', 'b', 'c']) expect(laneOf(container, id)).toBe('0')
      expect(lanesVar(container)).toBe('1')
    })

    it('C9 puts a 0-night stop on a stay start date in lane 1', () => {
      const pass = makeStop('p', 'Pass Stop', '2026-06-05', '2026-06-05')
      const { container } = renderTimeline({ stops: [stopA, pass, stopB, stopC] })
      expect(laneOf(container, 'p')).toBe('1')
      expect(laneOf(container, 'a')).toBe('0')
      expect(laneOf(container, 'b')).toBe('0')
      expect(lanesVar(container)).toBe('2')
      expect(
        (container.querySelector('[data-stop-id="p"]') as HTMLElement).style.getPropertyValue(
          '--timeline-lane'
        )
      ).toBe('1')
    })

    it('C9 does not offset the stay that starts on a 0-night stop date', () => {
      const pass = makeStop('p', 'Pass Stop', '2026-06-05', '2026-06-05')
      const { container } = renderTimeline({ stops: [stopA, pass, stopB, stopC] })
      const bravo = container.querySelector('[data-stop-id="b"]') as HTMLElement
      // trip 06-01..06-08 is 7 days; 06-05 is day 4
      expect(parseFloat(bravo.style.left)).toBeCloseTo((4 / 7) * 100, 2)
    })

    it('C9 gives two overlapping stays different lanes', () => {
      const x = makeStop('x', 'X Camp', '2026-06-01', '2026-06-05')
      const y = makeStop('y', 'Y Camp', '2026-06-03', '2026-06-08')
      const { container } = renderTimeline({ stops: [x, y] })
      expect(laneOf(container, 'x')).not.toBe(laneOf(container, 'y'))
    })

    it('C9 never lets bars in the same lane intersect', () => {
      const stops = [
        makeStop('s1', 'S1', '2026-06-01', '2026-06-04'),
        makeStop('s2', 'S2', '2026-06-04', '2026-06-07'),
        makeStop('p1', 'P1', '2026-06-04', '2026-06-04'),
        makeStop('s3', 'S3', '2026-06-07', '2026-06-10'),
        makeStop('p2', 'P2', '2026-06-07', '2026-06-07'),
        makeStop('o1', 'O1', '2026-06-08', '2026-06-12'),
        makeStop('p3', 'P3', '2026-06-12', '2026-06-12'),
        makeStop('p4', 'P4', '2026-06-12', '2026-06-12'),
        makeStop('s4', 'S4', '2026-06-12', '2026-06-14'),
      ]
      const { container } = renderTimeline({ stops })
      const duration = 13
      const spans = stops.map((stop) => {
        const el = container.querySelector(`[data-stop-id="${stop.id}"]`) as HTMLElement
        const start = Math.round((parseFloat(el.style.left) / 100) * duration)
        const nights = Math.round(
          (Date.parse(`${stop.endDate}T00:00:00`) - Date.parse(`${stop.startDate}T00:00:00`)) /
            86400000
        )
        return {
          lane: Number(el.getAttribute('data-lane')),
          start,
          end: start + (nights > 0 ? nights : 0.65),
        }
      })
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          if (spans[i].lane !== spans[j].lane) continue
          const disjoint =
            spans[i].end <= spans[j].start || spans[j].end <= spans[i].start
          expect(disjoint).toBe(true)
        }
      }
      expect(Math.max(...spans.map((x) => x.lane))).toBeGreaterThanOrEqual(1)
    })
  })
})
