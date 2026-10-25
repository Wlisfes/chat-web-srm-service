import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { AuthorizationGuard, AuthorizationModule, GatewayPrincipalGuard, GatewayPrincipalModule } from '@wlisfes/chat-web-base-schema/auth'
import { HttpResponseModule } from '@wlisfes/chat-web-base-schema/interceptor'
import { forRootNacosRuntimeOptions, NacosModule } from '@wlisfes/chat-web-base-schema/nacos'
import { RabbitmqModule } from '@wlisfes/chat-web-base-schema/rabbitmq'
import { RedisModule } from '@wlisfes/chat-web-base-schema/redis'
import { SMS_RABBITMQ_VHOST } from '@/modules/channel/channel-event.constants'
import { setupMessageTopology } from '@/modules/channel/channel-event.topology'
import { SimbankModule } from '@/modules/simbank/simbank.module'
import { ChannelModule } from '@/modules/channel/channel.module'
import { DatabaseModule } from '@/database/database.module'
import { RouteModule } from '@/modules/route/route.module'
import { UserModule } from '@/modules/user/user.module'
import { HealthModule } from '@/health/health.module'
import { FeignModule } from '@/feign/feign.module'
import { AppController } from '@/app.controller'
import { AppService } from '@/app.service'

@Module({
    imports: [
        HttpResponseModule,
        ConfigModule.forRoot({ isGlobal: true }),
        NacosModule.forRoot(forRootNacosRuntimeOptions(process.env)),
        RedisModule.forRoot({ database: 4 }),
        RabbitmqModule.forRoot({ vhost: SMS_RABBITMQ_VHOST, setup: setupMessageTopology }),
        DatabaseModule,
        GatewayPrincipalModule,
        AuthorizationModule,
        HealthModule,
        UserModule,
        SimbankModule,
        ChannelModule,
        RouteModule,
        FeignModule
    ],
    controllers: [AppController],
    providers: [
        AppService,
        { provide: APP_GUARD, useExisting: GatewayPrincipalGuard },
        { provide: APP_GUARD, useExisting: AuthorizationGuard }
    ]
})
export class AppModule {}
