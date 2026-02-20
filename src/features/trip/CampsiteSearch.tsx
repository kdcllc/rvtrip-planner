import {
  generateFreeCampsitesUrl,
  generateRVLifeUrl,
  generateHipcampUrl,
  generateCampendiumUrl,
  generateRVParkyUrl,
  openExternalLink,
  type MapBounds,
} from '../../utils/campsiteSearch'

type CampsiteSearchProps = {
  address?: string
  mapBounds?: MapBounds
  location?: { lat: number; lng: number } | null
}

export const CampsiteSearch = ({ address, mapBounds, location }: CampsiteSearchProps) => {
  const handleFreeCampsites = () => {
    const url = generateFreeCampsitesUrl(address)
    openExternalLink(url)
  }

  const handleRVLife = () => {
    const url = generateRVLifeUrl(address)
    openExternalLink(url)
  }

  const handleHipcamp = () => {
    const url = generateHipcampUrl(location, mapBounds, address)
    openExternalLink(url)
  }

  const handleCampendium = () => {
    const url = generateCampendiumUrl(address)
    openExternalLink(url)
  }

  const handleRVParky = () => {
    const url = generateRVParkyUrl(address, location)
    openExternalLink(url)
  }

  return (
    <div className="campsite-search-section">
      <div className="campsite-search-header">
        <div>
          <p className="campsite-search-title">Find campsites</p>
          <p className="muted">
            Search external sources, then paste details for this stop.
          </p>
        </div>
        <div className="campsite-search-actions">
          <button className="ghost" type="button" onClick={handleFreeCampsites}>
            🏕 Free Campsites
          </button>
          <button className="ghost" type="button" onClick={handleRVLife}>
            🛣️ RV Life
          </button>
          <button className="ghost" type="button" onClick={handleHipcamp}>
            🗺️ Hipcamp
          </button>
          <button className="ghost" type="button" onClick={handleCampendium}>
            🏞️ Campendium
          </button>
          <button className="ghost" type="button" onClick={handleRVParky}>
            🚐 RV Parky
          </button>
        </div>
      </div>
    </div>
  )
}
