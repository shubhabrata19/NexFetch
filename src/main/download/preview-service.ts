import { DomainError } from '@shared/domain/errors'
import type { EngineContext, EnginePreviewData } from '@shared/domain/engine'
import type { HttpPreview } from '@shared/domain/http'
import type { TorrentPreview } from '@shared/domain/torrent'
import type { YoutubePreview } from '@shared/domain/youtube'
import type { SourcePreviewEnvelope } from '@shared/ipc/contracts'
import type { DependencyService } from '../services/dependency-service'
import type { Logger } from '../services/logger'
import type { EngineRegistry } from '../engines/registry'
import type { PreviewCache } from './preview-cache'

export function toPreviewEnvelope(
  data: EnginePreviewData,
  token: { token: string; expiresAt: string },
): SourcePreviewEnvelope {
  if (data.engineId === 'youtube') {
    return {
      ...(data.data as YoutubePreview),
      engineId: 'youtube',
      previewToken: token.token,
      expiresAt: token.expiresAt,
    }
  }

  if (data.engineId === 'http') {
    return {
      ...(data.data as HttpPreview),
      engineId: 'http',
      previewToken: token.token,
      expiresAt: token.expiresAt,
    }
  }

  if (data.engineId === 'torrent') {
    const { metadataPath: _metadataPath, ...preview } = data.data as TorrentPreview & {
      metadataPath?: string
    }
    void _metadataPath
    return {
      ...preview,
      engineId: 'torrent',
      previewToken: token.token,
      expiresAt: token.expiresAt,
    }
  }

  throw new DomainError('INTERNAL_ERROR', 'This preview type is not supported yet.')
}

export class PreviewService {
  constructor(
    private readonly registry: EngineRegistry,
    private readonly cache: PreviewCache,
    private readonly dependencies: DependencyService,
    private readonly logger: Logger,
  ) {}

  async preview(url: string, signal: AbortSignal): Promise<SourcePreviewEnvelope> {
    const resolved = this.registry.resolve({ kind: 'text', value: url })
    if (!resolved.engine.preview) {
      throw new DomainError('UNSUPPORTED_SOURCE', 'This source does not support previews.')
    }

    const context: EngineContext = {
      signal,
      logger: this.logger,
      dependencies: this.dependencies,
    }
    const data = await resolved.engine.preview(resolved.source, context)
    return toPreviewEnvelope(data, this.cache.put(data))
  }

  getPreview(token: string) {
    return this.cache.get(token)
  }
}
