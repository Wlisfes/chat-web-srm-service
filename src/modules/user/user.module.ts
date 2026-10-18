import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TbSrmUser, TbSrmUserConfig, TbSrmUserContact } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientSkylineManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { UserController } from '@/modules/user/user.controller'
import { UserService } from '@/modules/user/user.service'
import { UserUtilsService } from '@/modules/user/user.utils.service'

@Module({
    imports: [TypeOrmModule.forFeature([TbSrmUser, TbSrmUserConfig, TbSrmUserContact]), FeignModule.register([FeignClientSkylineManager])],
    controllers: [UserController],
    providers: [UserService, UserUtilsService],
    exports: [UserService, UserUtilsService]
})
export class UserModule {}
