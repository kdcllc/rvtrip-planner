import type { WeatherCondition } from '../../domain/weather/types'

type WeatherIconProps = {
  condition: WeatherCondition
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const WEATHER_ICONS: Record<WeatherCondition, { emoji: string; label: string }> = {
  sunny: { emoji: '☀️', label: 'Sunny' },
  'partly-cloudy': { emoji: '🌤️', label: 'Partly Cloudy' },
  cloudy: { emoji: '☁️', label: 'Cloudy' },
  rainy: { emoji: '🌧️', label: 'Rainy' },
  stormy: { emoji: '⛈️', label: 'Stormy' },
  snow: { emoji: '🌨️', label: 'Snow' },
  unknown: { emoji: '❓', label: 'Unknown' },
}

export const WeatherIcon = ({
  condition,
  size = 'md',
  className = '',
}: WeatherIconProps) => {
  const { emoji, label } = WEATHER_ICONS[condition]

  return (
    <span
      className={`weather-icon weather-icon--${size} ${className}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {emoji}
    </span>
  )
}
