import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TbSrmChannel, TbSrmChannelPort, TbSrmRoute, TbSrmRouteChannel } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientCrmManager, FeignClientSkylineManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { RouteController } from '@/modules/route/route.controller'
import { RouteService } from '@/modules/route/route.service'

@Module({
    imports: [
        TypeOrmModule.forFeature([TbSrmRoute, TbSrmRouteChannel, TbSrmChannel, TbSrmChannelPort]),
        FeignModule.register([FeignClientSkylineManager, FeignClientCrmManager])
    ],
    controllers: [RouteController],
    providers: [RouteService],
    exports: [RouteService]
})
export class RouteModule {}
