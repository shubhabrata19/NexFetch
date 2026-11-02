import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import png2icons from 'png2icons'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inputPath = path.join(root, 'resources', 'assets', 'nexfetch_icon.png')
const buildDirectory = path.join(root, 'build')
const input = fs.readFileSync(inputPath)

fs.mkdirSync(buildDirectory, { recursive: true })

const ico = png2icons.createICO(input, png2icons.BICUBIC2, 0, false, true)
if (!ico) throw new Error('Failed to generate Windows ICO.')
fs.writeFileSync(path.join(buildDirectory, 'icon.ico'), ico)

const icns = png2icons.createICNS(input, png2icons.BICUBIC2, 0)
if (!icns) throw new Error('Failed to generate macOS ICNS.')
fs.writeFileSync(path.join(buildDirectory, 'icon.icns'), icns)
