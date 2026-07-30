import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailModule } from '../email/email.module.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { UsersModule } from '../users/users.module.js';

import { ActiveOrganisationResolver } from './active-organisation.resolver.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ActiveOrganisationGuard } from './guards/active-organisation.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { MfaEncryptionService } from './mfa/mfa-encryption.service.js';
import { MfaController } from './mfa/mfa.controller.js';
import { MfaService } from './mfa/mfa.service.js';
import { OidcModule } from './oidc/oidc.module.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [
    UsersModule,
    EmailModule,
    TypeOrmModule.forFeature([OrganisationMembership]),
    forwardRef(() => OidcModule.register()),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('app.jwt.secret'),
        signOptions: {
          expiresIn: config.get<number>('app.jwt.accessExpiresInSeconds', 900),
        },
      }),
    }),
  ],
  controllers: [AuthController, MfaController],
  providers: [
    AuthService,
    RefreshTokenService,
    JwtStrategy,
    ActiveOrganisationResolver,
    ActiveOrganisationGuard,
    RolesGuard,
    MfaService,
    MfaEncryptionService,
  ],
  exports: [
    AuthService,
    RefreshTokenService,
    PassportModule,
    JwtModule,
    JwtStrategy,
    ActiveOrganisationGuard,
    ActiveOrganisationResolver,
    RolesGuard,
  ],
})
export class AuthModule {}
