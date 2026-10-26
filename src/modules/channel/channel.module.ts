import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TbSrmChannel, TbSrmChannelPort } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientSkylineManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { ChannelController } from '@/modules/channel/channel.controller'
import { ChannelEventService } from '@/modules/channel/channel-event.service'
import { ChannelService } from '@/modules/channel/channel.service'
import { ChannelUtilsService } from '@/modules/channel/channel.utils.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'

@Module({
    imports: [TypeOrmModule.forFeature([TbSrmChannel, TbSrmChannelPort]), FeignModule.register([FeignClientSkylineManager])],
    controllers: [ChannelController],
    providers: [ChannelService, ChannelUtilsService, ChannelEventService, RouteConfigEventService],
    exports: [ChannelService, ChannelUtilsService, ChannelEventService]
})
export class ChannelModule {}
