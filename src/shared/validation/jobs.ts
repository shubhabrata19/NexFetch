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

export const youtubePreviewRequestSchema = z
  .object({
    url: z.string().min(1).max(2048),
    requestId: z.string().min(1).max(100),
  })
  .strict()

export const youtubeCancelPreviewSchema = z
  .object({
    requestId: z.string().min(1).max(100),
  })
  .strict()

export const createJobRequestSchema = z
  .object({
    previewToken: z.string().min(1).max(100),
    selection: youtubeSelectionSchema,
    destination: z.string().min(1).max(4096),
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
