import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TbSrmUser, TbSrmUserConfig, TbSrmUserContact } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientFinanceManager, FeignClientSkylineManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { UserController } from '@/modules/user/user.controller'
import { UserService } from '@/modules/user/user.service'
import { UserUtilsService } from '@/modules/user/user.utils.service'
import { UserBalanceService } from '@/modules/user/user.balance.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'

@Module({
    imports: [
        TypeOrmModule.forFeature([TbSrmUser, TbSrmUserConfig, TbSrmUserContact]),
        FeignModule.register([FeignClientSkylineManager, FeignClientFinanceManager])
    ],
    controllers: [UserController],
    providers: [UserService, UserUtilsService, UserBalanceService, RouteConfigEventService],
    exports: [UserService, UserUtilsService]
})
export class UserModule {}
