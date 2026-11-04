import type { MenuItemConstructorOptions } from 'electron'

export interface ContextMenuEditFlags {
  canUndo: boolean
  canRedo: boolean
  canCut: boolean
  canCopy: boolean
  canPaste: boolean
  canDelete: boolean
  canSelectAll: boolean
}

export interface ContextMenuTemplateInput {
  isEditable: boolean
  selectionText: string
  inputFieldType?: string
  editFlags: ContextMenuEditFlags
}

/**
 * Builds the native right-click menu for text fields and selected text.
 * Kept free of runtime Electron imports so it can be unit tested.
 */
export function buildContextMenuTemplate(
  params: ContextMenuTemplateInput,
): MenuItemConstructorOptions[] {
  const isPassword = params.inputFieldType === 'password'
  const flags = params.editFlags

  if (params.isEditable) {
    const template: MenuItemConstructorOptions[] = [
      { role: 'undo', label: 'Undo', enabled: flags.canUndo },
      { role: 'redo', label: 'Redo', enabled: flags.canRedo },
      { type: 'separator' },
    ]

    if (!isPassword) {
      template.push(
        { role: 'cut', label: 'Cut', enabled: flags.canCut },
        { role: 'copy', label: 'Copy', enabled: flags.canCopy },
      )
    }

    template.push(
      { role: 'paste', label: 'Paste', enabled: flags.canPaste },
      { role: 'delete', label: 'Delete', enabled: flags.canDelete },
      { type: 'separator' },
      { role: 'selectAll', label: 'Select All', enabled: flags.canSelectAll },
    )

    return template
  }

  if (params.selectionText.trim().length === 0) return []

  return [
    { role: 'copy', label: 'Copy', enabled: flags.canCopy },
    { type: 'separator' },
    { role: 'selectAll', label: 'Select All', enabled: flags.canSelectAll },
  ]
}
