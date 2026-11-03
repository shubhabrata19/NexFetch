import { z } from 'zod'

export const themeSchema = z.enum(['system', 'light', 'dark'])
export const torrentConnectionProfileSchema = z.enum(['balanced', 'high', 'maximum'])

export const settingsSchema = z
  .object({
    downloadDirectory: z.string().min(1).max(4096),
    maxConcurrentDownloads: z.number().int().min(1).max(5),
    concurrentFragments: z.number().int().min(1).max(16),
    maxDownloadRateBytesPerSecond: z.number().int().min(0).max(1_000_000_000),
    maxUploadRateBytesPerSecond: z.number().int().min(0).max(1_000_000_000),
    torrentConnectionProfile: torrentConnectionProfileSchema,
    torrentNATMapping: z.boolean(),
    torrentSeedAfterComplete: z.boolean(),
    resumeIncompleteDownloads: z.boolean(),
    theme: themeSchema,
  })
  .strict()

export const settingsPatchSchema = settingsSchema.partial().strict()

export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>
