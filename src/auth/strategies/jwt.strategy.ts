import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../common/context/correlation-id-context.js';
import { OrganisationMembership } from '../../organisations/entities/organisation-membership.entity.js';
import { UsersService } from '../../users/users.service.js';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';
import { IJwtPayload } from '../interfaces/jwt-payload.interface.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>(
        'app.jwt.secret',
        'change-me-in-production',
      ),
    });
  }

  async validate(payload: IJwtPayload): Promise<AuthenticatedUser> {
    setCurrentUserId(payload.sub);
    if (payload.orgId) {
      setCurrentOrganisationId(payload.orgId);
    }

    let user;
    try {
      user = await this.usersService.findById(payload.sub);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new UnauthorizedException('Unauthorized');
      }
      throw error;
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (payload.orgId) {
      const membership = await this.membershipRepo.findOne({
        where: {
          user: { id: payload.sub },
          organisation: { id: payload.orgId },
        },
        relations: ['organisation'],
      });

      if (!membership) {
        throw new UnauthorizedException(
          'You no longer have access to this organisation',
        );
      }

      return {
        ...user,
        organisationId: membership.organisation.id,
        roles: [membership.role],
        mfaEnrolmentRequired: payload.mfaEnrol === true,
      };
    }

    return { ...user, mfaEnrolmentRequired: payload.mfaEnrol === true };
  }
}
