import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditEventModule } from '../audit/audit-event.module.js';

import { UserOidcIdentity } from './entities/user-oidc-identity.entity.js';
import { User } from './entities/user.entity.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserOidcIdentity]),
    // The MFA and password writes record their own audit events; see
    // AuditEventModule for why this is not AuditModule.
    AuditEventModule,
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
