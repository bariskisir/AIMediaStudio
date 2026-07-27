/**
 * Generates packaged PNG and ICO assets from the canonical AI Media Studio SVG mark.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(scriptDirectory)
const svgPath = join(projectRoot, 'build', 'icon.svg')
const pngPath = join(projectRoot, 'build', 'icon.png')
const icoPath = join(projectRoot, 'build', 'icon.ico')

/** Renders the canonical vector at packaging resolution and creates both desktop formats. */
const generateIcons = async () => {
  const svg = await readFile(svgPath, 'utf8')
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng()
  await writeFile(pngPath, png)
  await writeFile(icoPath, await pngToIco(pngPath))
}

await generateIcons()
