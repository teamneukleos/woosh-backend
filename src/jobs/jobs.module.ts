import { Module } from '@nestjs/common';
import { CreatorModule } from '../creator/creator.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { JobsController } from './jobs.controller';
import { WorkRemindersService } from './work-reminders.service';

@Module({
  imports: [CreatorModule, PaymentsModule, NotificationsModule],
  controllers: [JobsController],
  providers: [WorkRemindersService],
})
export class JobsModule {}
