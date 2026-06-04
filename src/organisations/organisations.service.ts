import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateOrganisationDto } from './dto/create-organisation.dto.js';
import { UpdateOrganisationDto } from './dto/update-organisation.dto.js';
import { OrganisationMembership } from './entities/organisation-membership.entity.js';
import { Organisation } from './entities/organisation.entity.js';
import { MembershipStatus } from './membership-status.enum.js';
import { OrganisationRole } from './organisation-role.enum.js';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class OrganisationsService {
  constructor(
    @InjectRepository(Organisation)
    private readonly organisationsRepository: Repository<Organisation>,
    private readonly dataSource: DataSource,
  ) {}

  private async generateUniqueSlug(base: string): Promise<string> {
    const slug = toSlug(base);
    const taken = await this.organisationsRepository
      .createQueryBuilder('o')
      .select('o.slug')
      .where('o.slug = :slug OR o.slug LIKE :pattern', {
        slug,
        pattern: `${slug}-%`,
      })
      .getMany()
      .then((rows) => new Set(rows.map((r) => r.slug)));

    if (!taken.has(slug)) return slug;
    let n = 1;
    while (taken.has(`${slug}-${n}`)) n++;
    return `${slug}-${n}`;
  }

  async create(
    dto: CreateOrganisationDto,
    creatorId: string,
  ): Promise<Organisation> {
    setCurrentUserId(creatorId);
    setLastKnownUserIdForGuc(creatorId);

    const slug = await this.generateUniqueSlug(dto.name);

    if (dto.ukprn) {
      const ukprnTaken = await this.organisationsRepository.findOne({
        where: { ukprn: dto.ukprn },
      });
      if (ukprnTaken) {
        throw new ConflictException(
          'An organisation with this UKPRN already exists',
        );
      }
    }

    const id = randomUUID();

    // INSERT without RETURNING: RLS SELECT policies block RETURNING until membership exists.
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO organisations
          (id, name, slug, "portalType", ukprn, address, city, postcode, country, "orgEmail", "orgPhone", website, "logoUrl")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          dto.name.trim(),
          slug,
          dto.portalType ?? null,
          dto.ukprn ?? null,
          dto.address.trim(),
          dto.city.trim(),
          dto.postcode,
          dto.country.trim(),
          dto.orgEmail.trim(),
          dto.orgPhone?.trim() || null,
          dto.website?.trim() || null,
          dto.logoUrl?.trim() || null,
        ],
      );

      const membership = manager.create(OrganisationMembership, {
        user: { id: creatorId },
        organisation: { id },
        role: OrganisationRole.OWNER,
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
      await manager.save(membership);
    });

    return this.findOne(id);
  }

  async findAll(): Promise<Organisation[]> {
    return this.organisationsRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Organisation> {
    const organisation = await this.organisationsRepository.findOne({
      where: { id },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    return organisation;
  }

  async update(id: string, dto: UpdateOrganisationDto): Promise<Organisation> {
    const organisation = await this.findOne(id);

    if (dto.name !== undefined) organisation.name = dto.name.trim();
    if (dto.portalType !== undefined)
      organisation.portalType = dto.portalType ?? null;
    if (dto.ukprn !== undefined) {
      if (dto.ukprn !== organisation.ukprn) {
        const clash = await this.organisationsRepository.findOne({
          where: { ukprn: dto.ukprn },
        });
        if (clash && clash.id !== organisation.id) {
          throw new ConflictException(
            'An organisation with this UKPRN already exists',
          );
        }
      }
      organisation.ukprn = dto.ukprn;
    }
    if (dto.address !== undefined) organisation.address = dto.address.trim();
    if (dto.city !== undefined) organisation.city = dto.city.trim();
    if (dto.postcode !== undefined) organisation.postcode = dto.postcode;
    if (dto.country !== undefined) organisation.country = dto.country.trim();
    if (dto.orgEmail !== undefined) organisation.orgEmail = dto.orgEmail.trim();
    if (dto.orgPhone !== undefined)
      organisation.orgPhone = dto.orgPhone?.trim() || null;
    if (dto.website !== undefined)
      organisation.website = dto.website?.trim() || null;
    if (dto.logoUrl !== undefined)
      organisation.logoUrl = dto.logoUrl?.trim() || null;

    return this.organisationsRepository.save(organisation);
  }

  async remove(id: string): Promise<void> {
    const organisation = await this.findOne(id);
    await this.organisationsRepository.softRemove(organisation);
  }
}
