import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TbSrmSimbank } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientSkylineManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { UserModule } from '@/modules/user/user.module'
import { SimbankController } from '@/modules/simbank/simbank.controller'
import { SimbankService } from '@/modules/simbank/simbank.service'
import { SimbankUtilsService } from '@/modules/simbank/simbank.utils.service'

@Module({
    imports: [TypeOrmModule.forFeature([TbSrmSimbank]), FeignModule.register([FeignClientSkylineManager]), UserModule],
    controllers: [SimbankController],
    providers: [SimbankService, SimbankUtilsService],
    exports: [SimbankService, SimbankUtilsService]
})
export class SimbankModule {}
