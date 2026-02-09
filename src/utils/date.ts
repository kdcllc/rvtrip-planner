export const formatDateRange = (startDate: string, endDate: string) => {
  if (!startDate || !endDate) {
    return 'Dates not set'
  }

  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)

  return `${start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} - ${end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`
}

export const formatDate = (date: string) => {
  const normalized = new Date(`${date}T00:00:00`)
  return normalized.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
