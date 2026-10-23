import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import * as SrmSchema from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientCrmManager, FeignClientSkylineManager, FeignClientSmsManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { RouteController } from '@/modules/route/route.controller'
import { RouteService } from '@/modules/route/route.service'
import { RouteUtilsService } from '@/modules/route/route.utils.service'

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
        FeignModule.register([FeignClientSkylineManager, FeignClientCrmManager, FeignClientSmsManager])
    ],
    controllers: [RouteController],
    providers: [RouteService, RouteUtilsService],
    exports: [RouteService, RouteUtilsService]
})
export class RouteModule {}
