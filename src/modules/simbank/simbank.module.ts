import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TbSrmSimbank, TbSrmSimbankPort } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientSkylineManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { UserModule } from '@/modules/user/user.module'
import { SimbankController } from '@/modules/simbank/simbank.controller'
import { SimbankService } from '@/modules/simbank/simbank.service'
import { SimbankUtilsService } from '@/modules/simbank/simbank.utils.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'

@Module({
    imports: [TypeOrmModule.forFeature([TbSrmSimbank, TbSrmSimbankPort]), FeignModule.register([FeignClientSkylineManager]), UserModule],
    controllers: [SimbankController],
    providers: [SimbankService, SimbankUtilsService, RouteConfigEventService],
    exports: [SimbankService, SimbankUtilsService]
})
export class SimbankModule {}
