import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TbSrmChannel, TbSrmChannelPort, TbSrmSimbank, TbSrmSimbankPort } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientSkylineManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { SimbankModule } from '@/modules/simbank/simbank.module'
import { ChannelController } from '@/modules/channel/channel.controller'
import { ChannelService } from '@/modules/channel/channel.service'
import { ChannelUtilsService } from '@/modules/channel/channel.utils.service'

@Module({
    imports: [
        TypeOrmModule.forFeature([TbSrmChannel, TbSrmChannelPort, TbSrmSimbank, TbSrmSimbankPort]),
        FeignModule.register([FeignClientSkylineManager]),
        SimbankModule
    ],
    controllers: [ChannelController],
    providers: [ChannelService, ChannelUtilsService],
    exports: [ChannelService, ChannelUtilsService]
})
export class ChannelModule {}
