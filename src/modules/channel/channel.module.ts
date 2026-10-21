import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TbSrmChannel, TbSrmChannelPort, TbSrmSimbank, TbSrmSimbankPort } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientSkylineManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { ChannelController } from '@/modules/channel/channel.controller'
import { ChannelService } from '@/modules/channel/channel.service'

@Module({
    imports: [
        TypeOrmModule.forFeature([TbSrmChannel, TbSrmChannelPort, TbSrmSimbank, TbSrmSimbankPort]),
        FeignModule.register([FeignClientSkylineManager])
    ],
    controllers: [ChannelController],
    providers: [ChannelService],
    exports: [ChannelService]
})
export class ChannelModule {}
