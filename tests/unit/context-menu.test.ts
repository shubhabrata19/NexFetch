import { describe, expect, it } from 'vitest'
import { buildContextMenuTemplate } from '@main/context-menu-template'
import type { ContextMenuTemplateInput } from '@main/context-menu-template'

const editFlags = {
  canUndo: true,
  canRedo: false,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true,
}

function input(overrides: Partial<ContextMenuTemplateInput> = {}): ContextMenuTemplateInput {
  return {
    isEditable: true,
    selectionText: '',
    editFlags,
    ...overrides,
  }
}

describe('context menu template', () => {
  it('provides standard edit actions for text inputs', () => {
    const template = buildContextMenuTemplate(input())
    const roles = template.map((item) => item.role).filter(Boolean)

    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll'])
    expect(template.find((item) => item.role === 'paste')?.enabled).toBe(true)
    expect(template.find((item) => item.role === 'copy')?.enabled).toBe(true)
  })

  it('keeps paste available but hides cut and copy for password fields', () => {
    const template = buildContextMenuTemplate(input({ inputFieldType: 'password' }))
    const roles = template.map((item) => item.role).filter(Boolean)

    expect(roles).not.toContain('cut')
    expect(roles).not.toContain('copy')
    expect(roles).toContain('paste')
  })

  it('offers copy for selected read-only text', () => {
    const template = buildContextMenuTemplate(
      input({ isEditable: false, selectionText: 'selected text' }),
    )
    expect(template.map((item) => item.role).filter(Boolean)).toEqual(['copy', 'selectAll'])
  })

  it('shows nothing for an empty non-editable area', () => {
    expect(buildContextMenuTemplate(input({ isEditable: false }))).toEqual([])
  })

  it('reflects edit availability', () => {
    const template = buildContextMenuTemplate(
      input({
        editFlags: {
          ...editFlags,
          canPaste: false,
          canUndo: false,
        },
      }),
    )

    expect(template.find((item) => item.role === 'paste')?.enabled).toBe(false)
    expect(template.find((item) => item.role === 'undo')?.enabled).toBe(false)
  })
})
