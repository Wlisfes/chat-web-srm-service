import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import * as SrmSchema from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientCrmManager, FeignClientSkylineManager, FeignClientSmsManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { RouteController } from '@/modules/route/route.controller'
import { RouteService } from '@/modules/route/route.service'

/** 短信路由模块：方案 → 规则 → 规则通道，短信应用绑定方案；短信应用、客户和方向分别通过 SMS、CRM、Skyline Feign 查询。 */
@Module({
    imports: [
        TypeOrmModule.forFeature([
            SrmSchema.TbSrmRoute,
            SrmSchema.TbSrmRouteRule,
            SrmSchema.TbSrmRouteChannel,
            SrmSchema.TbSrmRouteApp,
            SrmSchema.TbSrmChannel,
            SrmSchema.TbSrmChannelPort
        ]),
        FeignModule.register([FeignClientSkylineManager, FeignClientCrmManager, FeignClientSmsManager])
    ],
    controllers: [RouteController],
    providers: [RouteService],
    exports: [RouteService]
})
export class RouteModule {}
