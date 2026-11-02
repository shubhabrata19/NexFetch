import { DomainError } from '@shared/domain/errors'
import type { EngineContext } from '@shared/domain/engine'
import type { YoutubePreview, YoutubePreviewEnvelope } from '@shared/domain/youtube'
import { classifyYoutubeInput } from '@shared/domain/youtube-url'
import type { DependencyService } from '../services/dependency-service'
import type { Logger } from '../services/logger'
import type { YoutubeEngine } from '../engines/youtube/youtube-engine'
import type { PreviewCache } from './preview-cache'

export class YoutubePreviewService {
  constructor(
    private readonly engine: YoutubeEngine,
    private readonly cache: PreviewCache,
    private readonly dependencies: DependencyService,
    private readonly logger: Logger,
  ) {}

  async preview(url: string, signal: AbortSignal): Promise<YoutubePreviewEnvelope> {
    const classification = classifyYoutubeInput(url)
    if (!classification) {
      throw new DomainError(
        'INVALID_URL',
        'Paste a valid YouTube video link, such as https://www.youtube.com/watch?v=…',
      )
    }
    if (classification.kind === 'unsupported') {
      throw new DomainError('UNSUPPORTED_SOURCE', classification.reason)
    }

    const context: EngineContext = {
      signal,
      logger: this.logger,
      dependencies: this.dependencies,
    }

    const data = await this.engine.preview(classification.source, context)
    const preview = data.data as YoutubePreview
    const token = this.cache.put(data)
    return {
      ...preview,
      previewToken: token.token,
      expiresAt: token.expiresAt,
    }
  }

  getPreview(token: string) {
    return this.cache.get(token)
  }
}
