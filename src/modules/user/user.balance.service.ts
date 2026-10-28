import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
    FeignClientFinanceManager,
    resolveFeignServiceAuthorization,
    type FinanceSrmUserSummary
} from '@wlisfes/chat-web-base-schema/feign'

/** Finance 供应商余额批量查询单次上限。 */
const SRM_USER_RESOLVE_LIMIT = 100

/** 供应商列表、详情展示的余额字段：来自 Finance 供应商账户。 */
export interface SupplierBalanceFields {
    /** USD 余额（放大百万倍存储值）：预付为负表示欠费，后付为负表示应付；Finance 不可用时为 null。 */
    balanceUsd: number | null
    /** 累计计费成本 USD（放大百万倍存储值）；Finance 不可用时为 null。 */
    billedUsd: number | null
    /** 累计计费短信条数；Finance 不可用时为 null。 */
    billCount: number | null
}

/**
 * 供应商余额：Finance 是供应商余额的权威来源，SRM 只通过 Feign 读取展示，不再读写 tb_srm_user 上的余额字段。
 * Finance 不可用时余额返回 null 并记录告警，不影响供应商列表和详情的其他内容。
 */
@Injectable()
export class UserBalanceService {
    private readonly logger = new Logger(UserBalanceService.name)

    constructor(
        private readonly financeFeignClient: FeignClientFinanceManager,
        private readonly configService: ConfigService
    ) {}

    /** 为供应商列表追加 Finance 余额，直接修改并返回原列表。 */
    public async fetchAppendBalance<T extends { keyId: number }>(list: T[]): Promise<Array<T & SupplierBalanceFields>> {
        const accounts = await this.findAccounts(list.map(item => item.keyId))
        for (const item of list) {
            const account = accounts?.get(item.keyId)
            Object.assign(item, {
                balanceUsd: accounts ? (account?.balanceUsd ?? 0) : null,
                billedUsd: accounts ? (account?.billedUsd ?? 0) : null,
                billCount: accounts ? (account?.billCount ?? 0) : null
            })
        }
        return list as Array<T & SupplierBalanceFields>
    }

    /** 按 100 个一批查询 Finance；失败时返回 undefined，由调用方展示为空余额。 */
    private async findAccounts(keyIds: number[]): Promise<Map<number, FinanceSrmUserSummary> | undefined> {
        const unique = [...new Set(keyIds)].filter(keyId => Number.isInteger(keyId) && keyId > 0)
        if (unique.length === 0) return new Map()
        try {
            const authorization = resolveFeignServiceAuthorization(this.configService)
            const groups = Array.from({ length: Math.ceil(unique.length / SRM_USER_RESOLVE_LIMIT) }, (_, index) =>
                unique.slice(index * SRM_USER_RESOLVE_LIMIT, (index + 1) * SRM_USER_RESOLVE_LIMIT)
            )
            const results = await Promise.all(
                groups.map(userKeyIds => this.financeFeignClient.httpBaseFinanceColumnSrmUserResolver(authorization, { userKeyIds }))
            )
            return new Map(results.flat().map(account => [account.userKeyId, account]))
        } catch (error) {
            this.logger.warn(`查询 Finance 供应商余额失败，余额暂不展示：${error instanceof Error ? error.message : String(error)}`)
            return undefined
        }
    }
}
