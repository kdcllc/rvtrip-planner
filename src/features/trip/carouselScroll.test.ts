// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollCarouselToStop } from './carouselScroll'

const rect = (left: number, width: number) =>
  ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0 }) as DOMRect

type Setup = {
  container: HTMLElement
  item: HTMLElement
  scrollTo: ReturnType<typeof vi.fn>
  itemScrollIntoView: ReturnType<typeof vi.fn>
}

const build = (itemLeft = 700): Setup => {
  const container = document.createElement('div')
  const item = document.createElement('div')
  item.className = 'stop-item'
  item.dataset.stopId = 'stop-1'
  container.appendChild(item)
  document.body.appendChild(container)

  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(100, 400))
  vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(itemLeft, 200))
  Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true })
  container.scrollLeft = 50

  const scrollTo = vi.fn()
  container.scrollTo = scrollTo as unknown as typeof container.scrollTo
  const itemScrollIntoView = vi.fn()
  item.scrollIntoView = itemScrollIntoView
  return { container, item, scrollTo, itemScrollIntoView }
}

const stubReducedMotion = (matches: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches })
  )
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('scrollCarouselToStop', () => {
  it('T1 returns false and scrolls nothing when the stop item is absent', () => {
    const { container, scrollTo } = build()
    expect(scrollCarouselToStop(container, 'missing')).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('T2 centres the item with a smooth scrollTo and returns true', () => {
    stubReducedMotion(false)
    const { container, scrollTo } = build()
    expect(scrollCarouselToStop(container, 'stop-1')).toBe(true)
    // 50 + (700 - 100) - (400 - 200) / 2 = 550
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ left: 550, behavior: 'smooth' })
  })

  it('T3 uses auto behavior when reduced motion is preferred', () => {
    stubReducedMotion(true)
    const { container, scrollTo } = build()
    scrollCarouselToStop(container, 'stop-1')
    expect(scrollTo).toHaveBeenCalledWith({ left: 550, behavior: 'auto' })
  })

  it('T4 clamps a negative computed left to 0', () => {
    stubReducedMotion(false)
    // 50 + (100 - 100) - 100 = -50
    const { container, scrollTo } = build(100)
    scrollCarouselToStop(container, 'stop-1')
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' })
  })

  it('T5 falls back to setting scrollLeft when scrollTo is not a function', () => {
    stubReducedMotion(false)
    const { container } = build()
    ;(container as unknown as { scrollTo: unknown }).scrollTo = undefined
    expect(scrollCarouselToStop(container, 'stop-1')).toBe(true)
    expect(container.scrollLeft).toBe(550)
  })

  it('T6 never calls scrollIntoView or window.scrollTo', () => {
    stubReducedMotion(false)
    const windowScrollTo = vi.fn()
    vi.stubGlobal('scrollTo', windowScrollTo)
    const { container, itemScrollIntoView } = build()
    scrollCarouselToStop(container, 'stop-1')
    expect(itemScrollIntoView).not.toHaveBeenCalled()
    expect(windowScrollTo).not.toHaveBeenCalled()
  })
})
