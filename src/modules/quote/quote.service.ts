import { FeignClientFinanceManager, resolveFeignServiceAuthorization } from '@wlisfes/chat-web-base-schema/feign'
import { PageResult, isNotEmpty, fetchZoomNumber, fetchUntiePagination } from '@wlisfes/chat-web-base-schema/utils'
import { InjectRepository, DataBaseService, In, Repository } from '@wlisfes/chat-web-base-schema/database'
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { AffectedResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { SimbankQuoteUtilsService } from '@/modules/quote/quote.utils.service'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { SimbankUtilsService } from '@/modules/simbank/simbank.utils.service'
import { UserUtilsService } from '@/modules/user/user.utils.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import * as SimbankQuoteDto from '@/modules/quote/dto/quote.dto'
import * as Schema from '@wlisfes/chat-web-base-schema'

/**
 * R 端供应商 simbank 报价：按 供应商 + simbank 设备 + 国家/地区 报价，流程与 SMS 客户报价一致：
 * 初始化草稿批次 → 编辑/删除/恢复草稿 → 预览统计 → 发布为正式报价。
 * 基础成本价来自 Finance tb_finance_frozen_simbank，汇率按供应商结算币种取 Finance 最新汇率。
 */
@Injectable()
export class SimbankQuoteService {
    constructor(
        @InjectRepository(Schema.TbSrmSimbankQuoteDraft) private readonly draftRepository: Repository<Schema.TbSrmSimbankQuoteDraft>,
        @InjectRepository(Schema.TbSrmSimbankQuote) private readonly quoteRepository: Repository<Schema.TbSrmSimbankQuote>,
        private readonly database: DataBaseService,
        private readonly userUtilsService: UserUtilsService,
        private readonly simbankUtilsService: SimbankUtilsService,
        private readonly simbankQuoteUtilsService: SimbankQuoteUtilsService,
        private readonly financeClient: FeignClientFinanceManager,
        private readonly configService: ConfigService,
        private readonly routeConfigEventService: RouteConfigEventService
    ) {}

    /**simbank 报价静态枚举。*/
    public async httpBaseSrmSimbankQuoteEnums(): Promise<SimbankQuoteDto.SimbankQuoteEnumsResponseDto> {
        return {
            changeStatusOptions: Schema.TbSrmSimbankQuoteDraftChangeStatusDefinition.options,
            draftStatusOptions: Schema.TbSrmSimbankQuoteDraftStatusDefinition.options,
            sourceOptions: Schema.TbSrmSimbankQuoteDraftSourceDefinition.options,
            statusOptions: Schema.TbSrmSimbankQuoteStatusDefinition.options
        }
    }

    /**按 Feign 单次上限分批查询 simbank 基础成本价格，并按入参顺序返回，缺失时抛错。*/
    private async findFrozenSimbankRequired(serviceAuthorization: string, countryKeyIds: number[]) {
        const uniqueKeyIds = [...new Set(countryKeyIds)]
        const groups: number[][] = []
        for (let index = 0; index < uniqueKeyIds.length; index += 100) {
            groups.push(uniqueKeyIds.slice(index, index + 100))
        }
        const results = await Promise.all(
            groups.map(keyIds =>
                this.financeClient.httpBaseFinanceColumnFrozenSimbankResolver(serviceAuthorization, { countryKeyIds: keyIds })
            )
        )
        const rateByCountry = new Map(results.flat().map(rate => [rate.countryKeyId, rate]))
        const missingKeyIds = uniqueKeyIds.filter(keyId => !rateByCountry.has(keyId))
        if (missingKeyIds.length > 0) {
            throw new BadRequestException(`以下国家/地区尚未配置 simbank 基础成本价格：${missingKeyIds.join(',')}`)
        }
        return uniqueKeyIds.map(keyId => rateByCountry.get(keyId)!)
    }

    /**批量查询供应商摘要；供应商在本服务库内，直接查表，缺失时不阻断列表展示。*/
    private async findUsers(keyIds: number[]) {
        const users = await this.userUtilsService.findByKeyIds(keyIds)
        const items = users.map(user => ({ keyId: user.keyId, name: user.name, alias: user.alias }))
        return { items, userOptions: new Map(items.map(user => [user.keyId, user])) }
    }

    /**初始化 simbank 报价草稿批次：simbank 必须归属该供应商；已有现行报价的国家沿用现行价，否则取 Finance 基础成本价。*/
    public async httpBaseSrmSimbankInitQuoteDraft(
        principal: AuthPrincipal,
        body: SimbankQuoteDto.InitSimbankQuoteDraftDto
    ): Promise<SimbankQuoteDto.InitSimbankQuoteDraftResponseDto> {
        // Finance 通过服务间 Feign 调用，使用服务凭据，不转发终端用户 Token。
        const serviceAuthorization = resolveFeignServiceAuthorization(this.configService)
        const [user, simbank, rates] = await Promise.all([
            this.userUtilsService.findRequired(body.userKeyId),
            this.simbankUtilsService.findRequired(body.simbankKeyId),
            this.findFrozenSimbankRequired(serviceAuthorization, body.countryKeyIds)
        ])
        if (simbank.userKeyId !== user.keyId) {
            throw new BadRequestException('simbank 设备不属于该供应商')
        }
        const exchange = await this.financeClient.httpBaseFinanceCurrencyExchangeResolver(serviceAuthorization, {
            currency: user.currency
        })

        return this.draftRepository.manager.transaction(async manager => {
            const draftRepository = manager.getRepository(Schema.TbSrmSimbankQuoteDraft)
            const countryKeyIds = rates.map(rate => rate.countryKeyId)
            const existingByCountry = await this.simbankQuoteUtilsService.findExistingQuoteMap(
                { userKeyId: user.keyId, simbankKeyId: simbank.keyId, countryKeyIds },
                manager
            )
            const draftBatchId = randomUUID()
            const drafts = rates.map(rate => {
                const existing = existingByCountry.get(rate.countryKeyId)
                const upUsd = existing?.upUsd ?? rate.upUsd
                const downUsd = existing?.downUsd ?? rate.downUsd
                return draftRepository.create({
                    draftBatchId,
                    userKeyId: user.keyId,
                    simbankKeyId: simbank.keyId,
                    userAlias: user.alias,
                    simbankAlias: simbank.alias,
                    countryKeyId: rate.countryKeyId,
                    code: rate.code,
                    mcc: rate.mcc,
                    upUsd,
                    downUsd,
                    currency: exchange.currency,
                    upLocal: Math.round(upUsd * exchange.rate),
                    downLocal: Math.round(downUsd * exchange.rate),
                    exchangeRate: exchange.rate,
                    exchangeDate: exchange.date,
                    effectiveTime: existing?.effectiveTime,
                    expiryTime: existing?.expiryTime,
                    source: existing ? Schema.TbSrmSimbankQuoteDraftSource.EXISTING : Schema.TbSrmSimbankQuoteDraftSource.ADDITION,
                    status: Schema.TbSrmSimbankQuoteDraftStatus.ENABLE,
                    remark: existing?.remark,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
            })
            await draftRepository.save(drafts)
            return { draftBatchId, total: drafts.length }
        })
    }

    /**分页查询simbank 报价草稿。*/
    public async httpBaseSrmSimbankColumnQuoteDraft(
        body: SimbankQuoteDto.ListSimbankQuoteDraftDto
    ): Promise<PageResult<SimbankQuoteDto.SimbankQuoteDraftListItemResponseDto>> {
        return this.database.builder(this.draftRepository, async qb => {
            qb.where('t.draftBatchId = :draftBatchId', { draftBatchId: body.draftBatchId })
            if (isNotEmpty(body.status)) {
                qb.andWhere('t.status = :status', { status: body.status })
            }
            qb.orderBy('t.countryKeyId', 'ASC')
            return await qb.getManyAndCount().then(async ([list, total]) => {
                // 变更状态实时对比现行报价：无现行报价为新增，价格相同为未变，否则为增长/降低；供应商信息直接查本库补充。
                // 统计基于整批有效草稿计算，不受分页和状态筛选影响。
                const [changeList, { userOptions }, summary] = await Promise.all([
                    this.simbankQuoteUtilsService.fetchDraftChangeList(list),
                    this.findUsers(list.map(item => item.userKeyId)),
                    this.simbankQuoteUtilsService.fetchDraftSummary(body.draftBatchId)
                ])
                return {
                    page: body.page,
                    size: body.size,
                    total,
                    summary,
                    list: changeList.map(item => ({ ...item, userOptions: userOptions.get(item.userKeyId) }))
                }
            })
        })
    }

    /**更新simbank 报价草稿。*/
    public async httpBaseSrmSimbankUpdateQuoteDraft(
        principal: AuthPrincipal,
        body: SimbankQuoteDto.UpdateSimbankQuoteDraftDto
    ): Promise<SimbankQuoteDto.SimbankQuoteDraftListItemResponseDto> {
        if ([body.upUsd, body.downUsd, body.effectiveTime].every(value => !isNotEmpty(value))) {
            throw new BadRequestException('上行费率、下行费率、生效时间至少修改一项')
        }
        return this.draftRepository.manager
            .transaction(async manager => {
                const draft = await this.simbankQuoteUtilsService.findDraft(body.keyId, manager)
                // 只修改传入的字段；费率变更时按草稿汇率同步重算对应的本币价格。
                if (isNotEmpty(body.upUsd)) {
                    const upUsd = Math.round(fetchZoomNumber(Number(body.upUsd)))
                    manager.merge(Schema.TbSrmSimbankQuoteDraft, draft, { upUsd, upLocal: Math.round(upUsd * Number(draft.exchangeRate)) })
                }
                if (isNotEmpty(body.downUsd)) {
                    const downUsd = Math.round(fetchZoomNumber(Number(body.downUsd)))
                    manager.merge(Schema.TbSrmSimbankQuoteDraft, draft, {
                        downUsd,
                        downLocal: Math.round(downUsd * Number(draft.exchangeRate))
                    })
                }
                if (isNotEmpty(body.effectiveTime)) {
                    manager.merge(Schema.TbSrmSimbankQuoteDraft, draft, { effectiveTime: new Date(body.effectiveTime) })
                }
                manager.merge(Schema.TbSrmSimbankQuoteDraft, draft, { modifyBy: principal.uid })
                return await manager.save(draft)
            })
            .then(async draft => {
                // 返回与列表一致的结构（含原价、最新变更状态），前端改价后直接回写当前行。
                const [node] = await this.simbankQuoteUtilsService.fetchDraftChangeList([draft])
                return node
            })
    }

    /**批量变更simbank 报价草稿状态：删除为软删除，可再恢复为正常。*/
    public async httpBaseSrmSimbankUpdateQuoteDraftStatus(
        principal: AuthPrincipal,
        body: SimbankQuoteDto.UpdateSimbankQuoteDraftStatusDto
    ): Promise<AffectedResponseDataDto> {
        const keyIds = [...new Set(body.keyIds)]
        const result = await this.draftRepository.update({ keyId: In(keyIds) }, { status: body.status, modifyBy: principal.uid })
        return { affected: result.affected ?? 0 }
    }

    /**批量移除simbank 报价草稿。*/
    public async httpBaseSrmSimbankDeleteQuoteDraft(body: SimbankQuoteDto.DeleteSimbankQuoteDraftDto): Promise<AffectedResponseDataDto> {
        // 移除是物理删除，删除后不可恢复；可恢复的删除走 draft/status/update。
        const result = await this.draftRepository.delete({ keyId: In([...new Set(body.keyIds)]) })
        return { affected: result.affected ?? 0 }
    }

    /**发布simbank 报价草稿批次。*/
    public async httpBaseSrmSimbankPublishQuote(
        principal: AuthPrincipal,
        body: SimbankQuoteDto.SimbankQuoteDraftBatchDto
    ): Promise<SimbankQuoteDto.PublishSimbankQuoteResponseDto> {
        const queryRunner = await this.database.transaction()
        const lockedScopes: Array<{ userKeyId: number; simbankKeyId: number }> = []
        try {
            const manager = queryRunner.manager
            const drafts = await this.simbankQuoteUtilsService.getActiveDraftBatch(body.draftBatchId, manager, '没有可发布的报价草稿')
            const scopes = new Map<string, { userKeyId: number; simbankKeyId: number }>()
            for (const draft of drafts) {
                scopes.set(`${draft.userKeyId}:${draft.simbankKeyId}`, { userKeyId: draft.userKeyId, simbankKeyId: draft.simbankKeyId })
            }
            // 按固定顺序加锁，避免多个批次交叉发布时出现锁等待环。
            for (const [, scope] of [...scopes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
                const acquired = await this.simbankQuoteUtilsService.acquireQuotePublishLock(
                    queryRunner,
                    scope.userKeyId,
                    scope.simbankKeyId
                )
                if (!acquired) {
                    throw new ConflictException('报价发布繁忙，请稍后重试')
                }
                lockedScopes.push(scope)
            }
            const quoteRepository = manager.getRepository(Schema.TbSrmSimbankQuote)
            const publishedTime = new Date()
            const quotes: Schema.TbSrmSimbankQuote[] = []
            for (const draft of drafts) {
                const effectiveTime = isNotEmpty(draft.effectiveTime) ? new Date(draft.effectiveTime) : publishedTime
                const expiryTime = isNotEmpty(draft.expiryTime) ? new Date(draft.expiryTime) : null
                if (isNotEmpty(expiryTime) && expiryTime.getTime() <= effectiveTime.getTime()) {
                    throw new BadRequestException(`${draft.code} 报价失效时间必须晚于生效时间`)
                }
                const scope = {
                    userKeyId: draft.userKeyId,
                    simbankKeyId: draft.simbankKeyId,
                    countryKeyId: draft.countryKeyId,
                    deleted: Schema.TbSrmSimbankQuoteStatus.DELETED,
                    effectiveTime
                }
                // 新报价生效前尚未生效的旧报价会被替换，标记为已作废。
                await quoteRepository
                    .createQueryBuilder()
                    .update(Schema.TbSrmSimbankQuote)
                    .set({ status: Schema.TbSrmSimbankQuoteStatus.DELETED, modifyBy: principal.uid })
                    .where('userKeyId = :userKeyId AND simbankKeyId = :simbankKeyId AND countryKeyId = :countryKeyId', scope)
                    .andWhere('status <> :deleted AND effectiveTime >= :effectiveTime', scope)
                    .execute()
                // 仍覆盖新生效时间的旧报价只截断失效时间，保留历史价格，状态由时间实时计算。
                await quoteRepository
                    .createQueryBuilder()
                    .update(Schema.TbSrmSimbankQuote)
                    .set({ expiryTime: effectiveTime, modifyBy: principal.uid })
                    .where('userKeyId = :userKeyId AND simbankKeyId = :simbankKeyId AND countryKeyId = :countryKeyId', scope)
                    .andWhere('status <> :deleted AND effectiveTime < :effectiveTime', scope)
                    .andWhere('(expiryTime IS NULL OR expiryTime > :effectiveTime)', scope)
                    .execute()
                const quote = quoteRepository.create({
                    userKeyId: draft.userKeyId,
                    simbankKeyId: draft.simbankKeyId,
                    userAlias: draft.userAlias,
                    simbankAlias: draft.simbankAlias,
                    countryKeyId: draft.countryKeyId,
                    code: draft.code,
                    mcc: draft.mcc,
                    upUsd: draft.upUsd,
                    downUsd: draft.downUsd,
                    currency: draft.currency,
                    upLocal: draft.upLocal,
                    downLocal: draft.downLocal,
                    exchangeRate: draft.exchangeRate,
                    exchangeDate: draft.exchangeDate,
                    effectiveTime,
                    expiryTime,
                    publishedTime,
                    remark: draft.remark,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
                quote.status = this.simbankQuoteUtilsService.resolveQuoteStatus(quote, publishedTime)
                quotes.push(quote)
            }
            await quoteRepository.save(quotes)
            // 发布成功后草稿已转为正式报价，直接物理删除该批次草稿。
            await manager.getRepository(Schema.TbSrmSimbankQuoteDraft).delete({ draftBatchId: body.draftBatchId })
            await queryRunner.commitTransaction()
            await this.routeConfigEventService.publish(`simbank 报价发布：draftBatchId=${body.draftBatchId}`)
            return { draftBatchId: body.draftBatchId, published: quotes.length }
        } catch (error) {
            if (queryRunner.isTransactionActive) {
                await queryRunner.rollbackTransaction()
            }
            throw error
        } finally {
            try {
                for (const scope of lockedScopes) {
                    await this.simbankQuoteUtilsService.releaseQuotePublishLock(queryRunner, scope.userKeyId, scope.simbankKeyId)
                }
            } finally {
                await queryRunner.release()
            }
        }
    }

    /**分页查询正式simbank 报价。*/
    public async httpBaseSrmSimbankColumnQuote(
        body: SimbankQuoteDto.ListSimbankQuoteDto
    ): Promise<PageResult<SimbankQuoteDto.SimbankQuoteListItemResponseDto>> {
        const now = new Date()
        const { page, size } = fetchUntiePagination(body)
        return this.database.builder(this.quoteRepository, async qb => {
            if (isNotEmpty(body.userKeyId)) {
                qb.andWhere('t.userKeyId = :userKeyId', { userKeyId: body.userKeyId })
            }
            if (isNotEmpty(body.userAlias?.trim())) {
                qb.andWhere('t.userAlias LIKE :userAlias', { userAlias: `%${body.userAlias.trim()}%` })
            }
            if (isNotEmpty(body.simbankKeyId)) {
                qb.andWhere('t.simbankKeyId = :simbankKeyId', { simbankKeyId: body.simbankKeyId })
            }
            if (isNotEmpty(body.simbankAlias?.trim())) {
                qb.andWhere('t.simbankAlias LIKE :simbankAlias', { simbankAlias: `%${body.simbankAlias.trim()}%` })
            }
            if (isNotEmpty(body.code?.trim())) {
                qb.andWhere('t.code = :code', { code: body.code.trim() })
            }
            if (isNotEmpty(body.mcc?.trim())) {
                qb.andWhere('t.mcc LIKE :mcc', { mcc: `%${body.mcc.trim()}%` })
            }
            if (isNotEmpty(body.statuses) && body.statuses.length > 0) {
                this.simbankQuoteUtilsService.whereQuoteStatuses(qb, body.statuses, now)
            }
            if (isNotEmpty(body.countryKeyIds) && body.countryKeyIds.length > 0) {
                qb.andWhere('t.countryKeyId IN (:...countryKeyIds)', { countryKeyIds: body.countryKeyIds })
            }
            qb.orderBy('t.publishedTime', 'DESC')
            qb.addOrderBy('t.keyId', 'DESC')
            qb.skip((page - 1) * size)
            qb.take(size)
            return await qb.getManyAndCount().then(async ([quotes, total]) => {
                const { userOptions } = await this.findUsers(quotes.map(quote => quote.userKeyId))
                return {
                    page: body.page,
                    size: body.size,
                    total,
                    list: quotes.map(quote => ({
                        ...quote,
                        status: this.simbankQuoteUtilsService.resolveQuoteStatus(quote, now),
                        userOptions: userOptions.get(quote.userKeyId)
                    }))
                }
            })
        })
    }
}
