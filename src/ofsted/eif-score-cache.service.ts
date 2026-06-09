import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../redis/redis.service.js';

import type { EifScoresPayloadDto } from './dto/eif-scores-response.dto.js';

@Injectable()
export class EifScoreCacheService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private ttlSeconds(): number {
    return this.config.get<number>('app.ofsted.eifScoreCacheTtlSeconds', 3600);
  }

  private key(organisationId: string): string {
    return `eif:scores:${organisationId}`;
  }

  async get(organisationId: string): Promise<EifScoresPayloadDto | null> {
    const ttl = this.ttlSeconds();
    if (ttl <= 0) return null;
    const raw = await this.redis.getClient().get(this.key(organisationId));
    if (!raw) return null;
    return JSON.parse(raw) as EifScoresPayloadDto;
  }

  async set(
    organisationId: string,
    payload: EifScoresPayloadDto,
  ): Promise<void> {
    const ttl = this.ttlSeconds();
    if (ttl <= 0) return;
    await this.redis
      .getClient()
      .setex(this.key(organisationId), ttl, JSON.stringify(payload));
  }

  async invalidate(organisationId: string): Promise<void> {
    if (this.ttlSeconds() <= 0) return;
    await this.redis.getClient().del(this.key(organisationId));
  }
}
