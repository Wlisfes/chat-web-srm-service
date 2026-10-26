import { FeignClientSkylineManager, FeignClientSmsManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { ChannelUtilsService } from '@/modules/channel/channel.utils.service'
import { RouteUtilsService } from '@/modules/route/route.utils.service'
import { RouteController } from '@/modules/route/route.controller'
import { RouteService } from '@/modules/route/route.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Module } from '@nestjs/common'
import * as SrmSchema from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'

@Module({
    imports: [
        TypeOrmModule.forFeature([
            SrmSchema.TbSrmRoute,
            SrmSchema.TbSrmRouteChannel,
            SrmSchema.TbSrmRouteRule,
            SrmSchema.TbSrmRouteApp,
            SrmSchema.TbSrmChannel,
            SrmSchema.TbSrmChannelPort
        ]),
        FeignModule.register([FeignClientSkylineManager, FeignClientSmsManager])
    ],
    controllers: [RouteController],
    providers: [RouteService, RouteUtilsService, ChannelUtilsService, RouteConfigEventService],
    exports: [RouteService, RouteUtilsService]
})
export class RouteModule {}
