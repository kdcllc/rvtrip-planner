import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const sourceSvg = path.resolve(__dirname, '../public/brand/rv-icon.svg')
const outputDir = path.resolve(__dirname, '../public/brand')

const sizes = [16, 32, 48, 192, 512]

async function generatePng(size) {
  const outputPath = path.join(outputDir, `rv-icon-${size}.png`)
  await sharp(sourceSvg)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(outputPath)
}

async function generateMaskable() {
  const outputPath = path.join(outputDir, 'rv-icon-maskable-512.png')
  const icon = await sharp(sourceSvg)
    .resize(400, 400)
    .png({ compressionLevel: 9 })
    .toBuffer()

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: icon, top: 56, left: 56 }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath)
}

async function run() {
  await Promise.all(sizes.map((size) => generatePng(size)))
  await generateMaskable()
  console.log('Generated PNG icons in public/brand.')
}

run().catch((error) => {
  console.error('Failed to generate icons:', error)
  process.exit(1)
})
