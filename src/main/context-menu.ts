import { Menu } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { buildContextMenuTemplate } from './context-menu-template'

export function attachContextMenu(
  contents: WebContents,
  getWindow: () => BrowserWindow | null,
): void {
  contents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params)
    if (template.length === 0) return

    const window = getWindow()
    Menu.buildFromTemplate(template).popup(window ? { window } : {})
  })
}
