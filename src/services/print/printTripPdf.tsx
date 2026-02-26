import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { createRoot } from 'react-dom/client'
import type { TripPrintData } from '../../domain/trip/print'
import { TripPrintLayout } from '../../features/trip/TripPrintLayout'
import { GOOGLE_MAPS_STATIC_API_KEY } from '../../config/env'
import { buildStaticMapUrl } from '../maps/googleMaps'

type PrintOptions = {
  fileName: string
}

const waitForImages = async (container: HTMLElement) => {
  const images = Array.from(container.querySelectorAll('img'))

  if (images.length === 0) {
    return
  }

  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve()
            return
          }

          const onDone = () => {
            img.removeEventListener('load', onDone)
            img.removeEventListener('error', onDone)
            resolve()
          }

          img.addEventListener('load', onDone)
          img.addEventListener('error', onDone)
        })
    )
  )
}

const fetchImageAsDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        resolve(typeof reader.result === 'string' ? reader.result : null)
      }
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.error('Failed to fetch map image:', error)
    return null
  }
}

const buildMapImage = async (data: TripPrintData): Promise<string | null> => {
  if (!GOOGLE_MAPS_STATIC_API_KEY) {
    return null
  }

  try {
    const url = buildStaticMapUrl(data.stops, {
      apiKey: GOOGLE_MAPS_STATIC_API_KEY,
      size: '1200x700',
    })
    return await fetchImageAsDataUrl(url)
  } catch (error) {
    console.error('Failed to build static map:', error)
    return null
  }
}

export const downloadTripPdf = async (
  data: TripPrintData,
  options: PrintOptions
): Promise<void> => {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = '820px'
  container.style.background = '#ffffff'
  container.style.zIndex = '-1'

  document.body.appendChild(container)
  const root = createRoot(container)

  try {
    const mapImageUrl = await buildMapImage(data)
    root.render(<TripPrintLayout data={data} mapImageUrl={mapImageUrl} />)

    await new Promise((resolve) => requestAnimationFrame(resolve))
    await waitForImages(container)

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    })

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgData = canvas.toDataURL('image/png')
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    let position = 0
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)

    let heightLeft = imgHeight - pageHeight
    while (heightLeft > 0) {
      position -= pageHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    pdf.save(options.fileName)
  } finally {
    try {
      root.unmount()
    } catch (error) {
      console.error('Failed to unmount print root:', error)
    } finally {
      container.remove()
    }
  }
}
