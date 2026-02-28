import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { createRoot } from 'react-dom/client'
import type { TripPrintData } from '../../domain/trip/print'
import { TripPrintLayout } from '../../features/trip/TripPrintLayout'
import { captureMapAsDataUrl } from '../maps/staticMapCapture'

type PrintOptions = {
  fileName: string
}

const PDF_HEADER_HEIGHT_PT = 34
const PDF_FOOTER_HEIGHT_PT = 24
const PDF_SIDE_MARGIN_PT = 24

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const canvasToBlob = async (
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg',
  quality?: number
): Promise<Blob> => {
  return await new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error(`Failed to encode canvas as ${type}`))
          return
        }

        resolve(blob)
      }, type, quality)
    } catch (error) {
      reject(error)
    }
  })
}

const isValidPng = (bytes: Uint8Array): boolean => {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false
  }

  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

const getPdfImagePayload = async (
  canvas: HTMLCanvasElement
): Promise<{ bytes: Uint8Array; format: 'PNG' | 'JPEG' }> => {
  try {
    const pngBlob = await canvasToBlob(canvas, 'image/png')
    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())

    if (isValidPng(pngBytes)) {
      return { bytes: pngBytes, format: 'PNG' }
    }
  } catch (error) {
    console.warn('Canvas PNG encoding failed, trying JPEG fallback:', error)
  }

  try {
    const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', 0.95)
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer())
    return { bytes: jpegBytes, format: 'JPEG' }
  } catch (error) {
    console.warn('Canvas JPEG encoding failed, trying data URL fallback:', error)

    // Final fallback path for environments where toBlob intermittently returns null.
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95)
    const base64 = jpegDataUrl.split(',')[1]
    if (!base64) {
      throw new Error('Failed to encode canvas as image/jpeg via data URL fallback')
    }

    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    return { bytes, format: 'JPEG' }
  }
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

const capturePageCanvas = async (
  container: HTMLElement,
  pageOffsetPx: number,
  pageHeightPx: number
): Promise<HTMLCanvasElement> => {
  return await html2canvas(container, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    y: pageOffsetPx,
    height: pageHeightPx,
    windowWidth: Math.ceil(container.scrollWidth),
    windowHeight: Math.ceil(container.scrollHeight),
    onclone: (clonedDocument) => {
      // Prevent html2canvas from attempting to clone live MapLibre WebGL canvases,
      // which can fail when preserveDrawingBuffer is false.
      clonedDocument
        .querySelectorAll('.maplibregl-canvas, .maplibregl-map')
        .forEach((node) => node.remove())
    },
  })
}

const getPageBreakOffsets = (
  container: HTMLElement,
  pageHeightPx: number,
  containerHeightPx: number
): number[] => {
  const offsets: number[] = [0]
  const minContentPerPagePx = Math.max(120, Math.floor(pageHeightPx * 0.35))
  const stopElements = Array.from(container.querySelectorAll<HTMLElement>('.print-stop'))
  const containerRect = container.getBoundingClientRect()

  const stopRanges = stopElements
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const top = Math.max(0, Math.round(rect.top - containerRect.top))
      const bottom = Math.min(containerHeightPx, Math.round(rect.bottom - containerRect.top))
      return { top, bottom }
    })
    .filter((range) => range.bottom > range.top)

  let currentOffset = 0
  while (currentOffset + 1 < containerHeightPx) {
    const targetBreak = currentOffset + pageHeightPx

    if (targetBreak >= containerHeightPx) {
      offsets.push(containerHeightPx)
      break
    }

    let nextBreak = targetBreak
    const splitStop = stopRanges.find((range) => range.top < targetBreak && range.bottom > targetBreak)

    if (splitStop) {
      const canMoveToStopTop =
        splitStop.top > currentOffset && splitStop.top - currentOffset >= minContentPerPagePx

      if (canMoveToStopTop) {
        nextBreak = splitStop.top
      }
    }

    if (nextBreak <= currentOffset) {
      nextBreak = Math.min(containerHeightPx, currentOffset + pageHeightPx)
    }

    offsets.push(nextBreak)
    currentOffset = nextBreak
  }

  if (offsets[offsets.length - 1] !== containerHeightPx) {
    offsets.push(containerHeightPx)
  }

  return offsets
}

const buildMapImage = async (data: TripPrintData): Promise<string | null> => {
  try {
    return await captureMapAsDataUrl(data.stops, {
      width: 1200,
      height: 700,
      includeRoutes: true,
    })
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
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await waitForImages(container)

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const contentX = PDF_SIDE_MARGIN_PT
    const contentY = PDF_HEADER_HEIGHT_PT
    const contentWidthPt = pageWidth - PDF_SIDE_MARGIN_PT * 2
    const contentHeightPt = pageHeight - PDF_HEADER_HEIGHT_PT - PDF_FOOTER_HEIGHT_PT
    const containerWidthPx = Math.max(container.clientWidth, container.scrollWidth)
    const containerHeightPx = Math.max(container.clientHeight, container.scrollHeight)

    if (containerWidthPx <= 0 || containerHeightPx <= 0) {
      throw new Error('Print layout rendered with invalid dimensions')
    }

    const pageHeightPx = Math.max(
      1,
      Math.floor((contentHeightPt * containerWidthPx) / contentWidthPt)
    )
    const pageOffsets = getPageBreakOffsets(container, pageHeightPx, containerHeightPx)
    const exportedDate = new Date(data.exportedAt)
    const exportedLabel = Number.isNaN(exportedDate.getTime())
      ? data.exportedAt
      : exportedDate.toLocaleDateString()

    for (let pageIndex = 0; pageIndex < pageOffsets.length - 1; pageIndex += 1) {
      const pageOffsetPx = pageOffsets[pageIndex]
      const currentPageHeightPx = pageOffsets[pageIndex + 1] - pageOffsetPx

      if (currentPageHeightPx <= 0) {
        continue
      }

      const pageCanvas = await capturePageCanvas(container, pageOffsetPx, currentPageHeightPx)
      const { bytes: imgData, format: imgFormat } = await getPdfImagePayload(pageCanvas)
      const imgWidth = contentWidthPt
      const imgHeight = (pageCanvas.height * imgWidth) / pageCanvas.width

      if (pageIndex > 0) {
        pdf.addPage()
      }

      // Header
      pdf.setTextColor(107, 114, 128)
      pdf.setFontSize(10)
      pdf.text(data.tripName, PDF_SIDE_MARGIN_PT, 18)
      pdf.text(`Exported ${exportedLabel}`, pageWidth - PDF_SIDE_MARGIN_PT, 18, {
        align: 'right',
      })
      pdf.setDrawColor(229, 231, 235)
      pdf.line(PDF_SIDE_MARGIN_PT, PDF_HEADER_HEIGHT_PT - 8, pageWidth - PDF_SIDE_MARGIN_PT, PDF_HEADER_HEIGHT_PT - 8)

      // Footer
      const pageLabel = `Page ${pageIndex + 1} of ${pageOffsets.length - 1}`
      pdf.line(
        PDF_SIDE_MARGIN_PT,
        pageHeight - PDF_FOOTER_HEIGHT_PT + 6,
        pageWidth - PDF_SIDE_MARGIN_PT,
        pageHeight - PDF_FOOTER_HEIGHT_PT + 6
      )
      pdf.setTextColor(107, 114, 128)
      pdf.setFontSize(9)
      pdf.text(pageLabel, pageWidth / 2, pageHeight - 8, { align: 'center' })

      pdf.addImage(imgData, imgFormat, contentX, contentY, imgWidth, imgHeight)
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
