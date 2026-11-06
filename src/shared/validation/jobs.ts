import { z } from 'zod'

const formatIdSchema = z.string().min(1).max(100)

export const youtubeSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('best-up-to-4k') }).strict(),
  z
    .object({
      mode: z.literal('video'),
      videoFormatId: formatIdSchema,
      audioFormatId: formatIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('audio'),
      audioFormatId: formatIdSchema,
    })
    .strict(),
])

export const checksumSchema = z
  .object({
    algorithm: z.literal('sha256'),
    expectedHex: z.string().regex(/^[0-9a-fA-F]{64}$/),
  })
  .strict()

export const httpSelectionSchema = z
  .object({
    checksum: checksumSchema.optional(),
  })
  .strict()

const rateLimitSchema = z.number().int().min(0).max(1_000_000_000).nullable()
const peerLimitSchema = z.number().int().min(1).max(1000).nullable()

export const torrentSelectionSchema = z
  .object({
    fileIndices: z.array(z.number().int().min(0).max(50_000)).max(50_000),
    downloadLimitBytesPerSecond: rateLimitSchema.optional(),
    uploadLimitBytesPerSecond: rateLimitSchema.optional(),
    maxConnections: peerLimitSchema.optional(),
    seedAfterComplete: z.boolean().optional(),
  })
  .strict()

export const torrentLimitsRequestSchema = z
  .object({
    jobId: z.string().min(1).max(100),
    downloadLimitBytesPerSecond: rateLimitSchema,
    uploadLimitBytesPerSecond: rateLimitSchema,
    maxConnections: peerLimitSchema,
  })
  .strict()

export const torrentSetupUpdateSchema = z
  .object({
    jobId: z.string().min(1).max(100),
    destination: z.string().min(1).max(4096),
    fileIndices: z.array(z.number().int().min(0).max(50_000)).max(50_000),
    downloadLimitBytesPerSecond: rateLimitSchema,
    uploadLimitBytesPerSecond: rateLimitSchema,
    maxConnections: peerLimitSchema,
    seedAfterComplete: z.boolean(),
  })
  .strict()

export const torrentLookupRequestSchema = z
  .object({
    source: z.string().trim().min(1).max(8192),
  })
  .strict()

const MAX_TORRENT_BYTES = 10 * 1024 * 1024

export const torrentPreviewFileRequestSchema = z
  .object({
    requestId: z.string().min(1).max(100),
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => /\.torrent$/i.test(value), {
        message: 'Choose a .torrent file.',
      }),
  })
  .strict()

export const torrentBytesPreviewRequestSchema = z
  .object({
    requestId: z.string().min(1).max(100),
    name: z.string().min(1).max(260),
    dataBase64: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_TORRENT_BYTES * 4) / 3) + 16)
      .refine((value) => /^[A-Za-z0-9+/]*={0,2}$/.test(value), {
        message: 'The torrent file data is not valid base64.',
      }),
  })
  .strict()

export const torrentCancelPreviewSchema = z
  .object({
    requestId: z.string().min(1).max(100),
  })
  .strict()

export const scheduledAtSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: 'The scheduled time must be a valid ISO timestamp.',
  })

export const youtubePreviewRequestSchema = z
  .object({
    url: z.string().min(1).max(2048),
    requestId: z.string().min(1).max(100),
  })
  .strict()

export const previewRequestSchema = youtubePreviewRequestSchema

export const youtubeCancelPreviewSchema = z
  .object({
    requestId: z.string().min(1).max(100),
  })
  .strict()

export const previewCancelSchema = youtubeCancelPreviewSchema

export const createJobRequestSchema = z
  .object({
    previewToken: z.string().min(1).max(100),
    selection: z.union([youtubeSelectionSchema, httpSelectionSchema, torrentSelectionSchema]),
    destination: z.string().min(1).max(4096),
    scheduledAt: scheduledAtSchema.optional(),
    deferStart: z.boolean().optional(),
  })
  .strict()

export const jobIdRequestSchema = z
  .object({
    jobId: z.string().min(1).max(100),
  })
  .strict()

export const openLocationRequestSchema = z
  .object({
    jobId: z.string().min(1).max(100),
    revealFile: z.boolean().optional(),
  })
  .strict()

export type YoutubeSelectionInput = z.infer<typeof youtubeSelectionSchema>
export type HttpSelectionInput = z.infer<typeof httpSelectionSchema>
export type TorrentSelectionInput = z.infer<typeof torrentSelectionSchema>
