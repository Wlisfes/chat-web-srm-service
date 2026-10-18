import { Injectable } from '@nestjs/common'
import * as FeignSchema from '@wlisfes/chat-web-base-schema/feign'
import { UserService } from '@/modules/user/user.service'
import { UserUtilsService } from '@/modules/user/user.utils.service'

/** 统一编排 SRM 服务对外暴露的供应商 Feign 调用。 */
@Injectable()
export class FeignService extends FeignSchema.FeignClientSrmManager implements FeignSchema.FeignClientSrmImplementation {
    constructor(
        private readonly userService: UserService,
        private readonly userUtilsService: UserUtilsService
    ) {
        super()
    }

    /** 按供应商主键获取供应商详情。 */
    public override async httpBaseSrmUserResolver(
        _authorization: string,
        input: FeignSchema.SrmResolveUserInput
    ): Promise<FeignSchema.SrmUser> {
        return this.userUtilsService.findRequired(input.keyId)
    }

    /** 按供应商主键批量获取供应商详情，单次最多 100 个。 */
    public override async httpBaseSrmColumnUserResolver(
        _authorization: string,
        input: FeignSchema.SrmColumnUserResolverInput
    ): Promise<FeignSchema.SrmUser[]> {
        return this.userUtilsService.findColumnResolver(input.keyIds ?? [])
    }

    /** 分页查询供应商列表；对分页字段做空值兜底，保证服务间响应结构稳定。 */
    public override async httpBaseSrmColumnUser(
        _authorization: string,
        input: FeignSchema.SrmListUserInput
    ): Promise<FeignSchema.SrmUserPage> {
        const result = await this.userService.httpBaseSrmColumnUser(input)
        return {
            page: result.page ?? input.page,
            size: result.size ?? input.size,
            total: result.total ?? 0,
            list: result.list ?? []
        }
    }
}
