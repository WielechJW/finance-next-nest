import { Global, Module } from '@nestjs/common';
import { getSessionConfig } from './session.config.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  providers: [
    {
      provide: SessionService,
      useFactory: () => new SessionService(getSessionConfig()),
    },
  ],
  exports: [SessionService],
})
export class SessionModule {}
