import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TbSrmUser, TbSrmUserConfig, TbSrmUserContact } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import {
    FeignClientCrmManager,
    FeignClientFinanceManager,
    FeignClientSkylineManager,
    FeignModule
} from '@wlisfes/chat-web-base-schema/feign'
import { UserController } from '@/modules/user/user.controller'
import { UserService } from '@/modules/user/user.service'
import { UserUtilsService } from '@/modules/user/user.utils.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'

@Module({
    imports: [
        TypeOrmModule.forFeature([TbSrmUser, TbSrmUserConfig, TbSrmUserContact]),
        FeignModule.register([FeignClientSkylineManager, FeignClientFinanceManager, FeignClientCrmManager])
    ],
    controllers: [UserController],
    providers: [UserService, UserUtilsService, RouteConfigEventService],
    exports: [UserService, UserUtilsService]
})
export class UserModule {}
