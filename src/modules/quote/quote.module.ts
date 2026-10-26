import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TbSrmSimbankQuote, TbSrmSimbankQuoteDraft } from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { FeignClientFinanceManager, FeignModule } from '@wlisfes/chat-web-base-schema/feign'
import { SimbankModule } from '@/modules/simbank/simbank.module'
import { UserModule } from '@/modules/user/user.module'
import { SimbankQuoteController } from '@/modules/quote/quote.controller'
import { SimbankQuoteService } from '@/modules/quote/quote.service'
import { SimbankQuoteUtilsService } from '@/modules/quote/quote.utils.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'

/** R 端供应商 simbank 报价模块；供应商和 simbank 在本库，基础成本价与汇率归属 Finance。 */
@Module({
    imports: [
        TypeOrmModule.forFeature([TbSrmSimbankQuote, TbSrmSimbankQuoteDraft]),
        FeignModule.register([FeignClientFinanceManager]),
        UserModule,
        SimbankModule
    ],
    controllers: [SimbankQuoteController],
    providers: [SimbankQuoteService, SimbankQuoteUtilsService, RouteConfigEventService]
})
export class SimbankQuoteModule {}
