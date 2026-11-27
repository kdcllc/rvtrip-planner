/**
 * Scrolls the stop carousel sideways so the stop's card is centred.
 * Only the carousel container scrolls; the page never moves.
 */
export function scrollCarouselToStop(container: HTMLElement, stopId: string): boolean {
  const item = Array.from(
    container.querySelectorAll<HTMLElement>('.stop-item[data-stop-id]')
  ).find((el) => el.dataset.stopId === stopId)
  if (!item) {
    return false
  }

  const itemRect = item.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const left = Math.max(
    0,
    container.scrollLeft +
      (itemRect.left - containerRect.left) -
      (container.clientWidth - itemRect.width) / 2
  )

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' })
  } else {
    container.scrollLeft = left
  }
  return true
}
