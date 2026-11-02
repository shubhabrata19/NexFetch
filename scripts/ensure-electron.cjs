const { existsSync } = require('node:fs')
const { join } = require('node:path')

const installer = join(__dirname, '..', 'node_modules', 'electron', 'install.js')
if (existsSync(installer)) {
  require(installer)
}
