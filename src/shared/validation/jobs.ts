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
    selection: z.union([youtubeSelectionSchema, httpSelectionSchema]),
    destination: z.string().min(1).max(4096),
    scheduledAt: scheduledAtSchema.optional(),
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
