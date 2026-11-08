const { existsSync } = require('node:fs')
const { join } = require('node:path')

// CI verify jobs set this flag because they only typecheck, lint, test, and
// build the Vite output; they never launch or package Electron. Honouring the
// flag also keeps those jobs working when the Electron download CDN is briefly
// unavailable.
const skipDownload = [
  process.env.ELECTRON_SKIP_BINARY_DOWNLOAD,
  process.env.npm_config_electron_skip_binary_download,
]
  .filter((value) => typeof value === 'string')
  .map((value) => value.trim().toLowerCase())
  .some((value) => value === '1' || value === 'true')

if (skipDownload) {
  process.exit(0)
}

const installer = join(__dirname, '..', 'node_modules', 'electron', 'install.js')
if (existsSync(installer)) {
  require(installer)
}
