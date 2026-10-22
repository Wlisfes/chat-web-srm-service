import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import * as SrmSchema from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientCrmManager, FeignClientSkylineManager, FeignClientSmsManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { RouteController } from '@/modules/route/route.controller'
import { RouteService } from '@/modules/route/route.service'

/** 短信路由模块：路由由规则组决定接收哪些短信，挂多个通道负责发送；短信应用绑定定向路由，未绑定的应用按优先级使用通用路由；短信应用、客户和方向分别通过 SMS、CRM、Skyline Feign 查询。 */
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
    providers: [RouteService],
    exports: [RouteService]
})
export class RouteModule {}
