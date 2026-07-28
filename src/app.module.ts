import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BrandsModule } from './brands/brands.module';
import { CreatorsModule } from './creators/creators.module';
import { PrismaModule } from './prisma/prisma.module';
import { SocialConnectionsModule } from './social-connections/social-connections.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    CreatorsModule,
    BrandsModule,
    SocialConnectionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
