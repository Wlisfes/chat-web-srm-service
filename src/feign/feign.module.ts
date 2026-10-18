import { Module } from '@nestjs/common'
import { UserModule } from '@/modules/user/user.module'
import { FeignController } from '@/feign/feign.controller'
import { FeignService } from '@/feign/feign.service'

@Module({
    imports: [UserModule],
    controllers: [FeignController],
    providers: [FeignService]
})
export class FeignModule {}
