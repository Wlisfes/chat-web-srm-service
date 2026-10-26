import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository, Brackets, DataBaseService, EntityManager } from '@wlisfes/chat-web-base-schema/database'
import { QueryRunner, Repository, SelectQueryBuilder } from '@wlisfes/chat-web-base-schema/database'
import { isNotEmpty } from '@wlisfes/chat-web-base-schema/utils'
import * as Schema from '@wlisfes/chat-web-base-schema'

@Injectable()
export class SimbankQuoteUtilsService {
    constructor(
        @InjectRepository(Schema.TbSrmSimbankQuoteDraft) private readonly draftRepository: Repository<Schema.TbSrmSimbankQuoteDraft>,
        private readonly database: DataBaseService
    ) {}

    /**查询供应商 simbank在指定国家/地区的现行报价（未作废、未失效，按生效时间取最新一条），作为草稿价格变更的对比基准。*/
    public async findExistingQuoteMap(
        scope: { userKeyId: number; simbankKeyId: number; countryKeyIds: number[] },
        manager?: EntityManager
    ): Promise<Map<number, Schema.TbSrmSimbankQuote>> {
        const existingMap = new Map<number, Schema.TbSrmSimbankQuote>()
        if (scope.countryKeyIds.length === 0) {
            return existingMap
        }
        const repository = (manager ?? this.draftRepository.manager).getRepository(Schema.TbSrmSimbankQuote)
        const list = await this.database.builder(repository, qb => {
            qb.where('t.userKeyId = :userKeyId AND t.simbankKeyId = :simbankKeyId', scope)
            qb.andWhere('t.countryKeyId IN (:...countryKeyIds)', scope)
            qb.andWhere('t.status <> :deleted', { deleted: Schema.TbSrmSimbankQuoteStatus.DELETED })
            qb.andWhere('(t.expiryTime IS NULL OR t.expiryTime > :now)', { now: new Date() })
            qb.orderBy('t.effectiveTime', 'DESC').addOrderBy('t.keyId', 'DESC')
            return qb.getMany()
        })
        for (const quote of list) {
            if (!existingMap.has(quote.countryKeyId)) {
                existingMap.set(quote.countryKeyId, quote)
            }
        }
        return existingMap
    }

    /**对比现行报价得出价格变更状态：无现行报价为新增，价格相同为未变，否则为增长或降低。*/
    public fetchChangeStatus(price: number, existing?: number): Schema.TbSrmSimbankQuoteDraftChangeStatus {
        if (!isNotEmpty(existing)) {
            return Schema.TbSrmSimbankQuoteDraftChangeStatus.NEW
        } else if (Number(price) === Number(existing)) {
            return Schema.TbSrmSimbankQuoteDraftChangeStatus.CURRENT
        }
        return Number(price) > Number(existing)
            ? Schema.TbSrmSimbankQuoteDraftChangeStatus.INCREASE
            : Schema.TbSrmSimbankQuoteDraftChangeStatus.DECREASE
    }

    /**为草稿列表追加现行报价原价与上下行价格变更状态；金额保持放大百万倍的存储值，由前端自行转换。*/
    public async fetchDraftChangeList(list: Schema.TbSrmSimbankQuoteDraft[]) {
        const existingMap = new Map<string, Schema.TbSrmSimbankQuote>()
        const scopes = new Map<string, Schema.TbSrmSimbankQuoteDraft[]>()
        for (const item of list) {
            const key = `${item.userKeyId}:${item.simbankKeyId}`
            scopes.set(key, [...(scopes.get(key) ?? []), item])
        }
        for (const items of scopes.values()) {
            const { userKeyId, simbankKeyId } = items[0]
            const countryKeyIds = [...new Set(items.map(item => item.countryKeyId))]
            const scopeMap = await this.findExistingQuoteMap({ userKeyId, simbankKeyId, countryKeyIds })
            scopeMap.forEach((quote, countryKeyId) => existingMap.set(`${userKeyId}:${simbankKeyId}:${countryKeyId}`, quote))
        }
        return list.map(item => {
            const existing = existingMap.get(`${item.userKeyId}:${item.simbankKeyId}:${item.countryKeyId}`)
            return {
                ...item,
                existingUpUsd: existing ? existing.upUsd : null,
                existingDownUsd: existing ? existing.downUsd : null,
                upStatus: this.fetchChangeStatus(item.upUsd, existing?.upUsd),
                downStatus: this.fetchChangeStatus(item.downUsd, existing?.downUsd)
            }
        })
    }

    /**统计草稿批次（仅有效草稿，不含软删除）：报价条目、国家/地区、新增/涨价/降价（上行或下行任一满足）、定时生效数。*/
    public async fetchDraftSummary(draftBatchId: string) {
        const drafts = await this.database.builder(this.draftRepository, qb => {
            qb.where('t.draftBatchId = :draftBatchId', { draftBatchId })
            qb.andWhere('t.status = :status', { status: Schema.TbSrmSimbankQuoteDraftStatus.ENABLE })
            return qb.getMany()
        })
        const items = await this.fetchDraftChangeList(drafts)
        const now = Date.now()
        const count = (status: Schema.TbSrmSimbankQuoteDraftChangeStatus) => {
            return items.filter(item => item.upStatus === status || item.downStatus === status).length
        }
        return {
            total: items.length,
            countries: new Set(items.map(item => item.countryKeyId)).size,
            additions: count(Schema.TbSrmSimbankQuoteDraftChangeStatus.NEW),
            increases: count(Schema.TbSrmSimbankQuoteDraftChangeStatus.INCREASE),
            decreases: count(Schema.TbSrmSimbankQuoteDraftChangeStatus.DECREASE),
            scheduled: items.filter(item => item.effectiveTime && new Date(item.effectiveTime).getTime() > now).length
        }
    }

    /**查询报价草稿。*/
    public async findDraft(keyId: number, manager?: EntityManager): Promise<Schema.TbSrmSimbankQuoteDraft> {
        const repository = (manager ?? this.draftRepository.manager).getRepository(Schema.TbSrmSimbankQuoteDraft)
        const draft = await this.database.builder(repository, qb => {
            qb.where('t.keyId = :keyId', { keyId })
            if (isNotEmpty(manager)) {
                qb.setLock('pessimistic_write')
            }
            return qb.getOne()
        })
        if (!draft) {
            throw new NotFoundException('报价草稿不存在')
        }
        return draft
    }

    /**查询报价草稿批次。*/
    public async getActiveDraftBatch(
        draftBatchId: string,
        manager?: EntityManager,
        notFoundMessage = '没有可用的报价草稿'
    ): Promise<Schema.TbSrmSimbankQuoteDraft[]> {
        const repository = (manager ?? this.draftRepository.manager).getRepository(Schema.TbSrmSimbankQuoteDraft)
        const list = await this.database.builder(repository, qb => {
            // 软删除的草稿不参与预览和发布。
            qb.where('t.draftBatchId = :draftBatchId', { draftBatchId })
                .andWhere('t.status = :status', { status: Schema.TbSrmSimbankQuoteDraftStatus.ENABLE })
                .orderBy('t.countryKeyId', 'ASC')
            if (isNotEmpty(manager)) {
                qb.setLock('pessimistic_write')
            }
            return qb.getMany()
        })
        if (list.length === 0) {
            throw new NotFoundException(notFoundMessage)
        }
        return list
    }

    /**获取同一供应商、同一 simbank的报价发布锁，防止并发发布产生重叠有效报价。*/
    public async acquireQuotePublishLock(queryRunner: QueryRunner, userKeyId: number, simbankKeyId: number): Promise<boolean> {
        const lockName = `srm:simbank:quote:${userKeyId}:${simbankKeyId}`
        const [result] = (await queryRunner.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, 5])) as Array<{
            acquired: number | string | null
        }>
        return Number(result?.acquired) === 1
    }

    /**释放报价发布锁。*/
    public async releaseQuotePublishLock(queryRunner: QueryRunner, userKeyId: number, simbankKeyId: number): Promise<void> {
        const lockName = `srm:simbank:quote:${userKeyId}:${simbankKeyId}`
        await queryRunner.query('SELECT RELEASE_LOCK(?) AS released', [lockName])
    }

    /**按生效、失效时间实时计算报价状态；deleted 为手动作废，不随时间变化。*/
    public resolveQuoteStatus(
        quote: Pick<Schema.TbSrmSimbankQuote, 'status' | 'effectiveTime' | 'expiryTime'>,
        now: Date
    ): Schema.TbSrmSimbankQuoteStatus {
        if (quote.status === Schema.TbSrmSimbankQuoteStatus.DELETED) {
            return Schema.TbSrmSimbankQuoteStatus.DELETED
        }
        if (isNotEmpty(quote.expiryTime) && new Date(quote.expiryTime).getTime() <= now.getTime()) {
            return Schema.TbSrmSimbankQuoteStatus.EXPIRED
        }
        if (new Date(quote.effectiveTime).getTime() <= now.getTime()) {
            return Schema.TbSrmSimbankQuoteStatus.EFFECTIVE
        }
        return Schema.TbSrmSimbankQuoteStatus.PENDING
    }

    /**按实时状态追加查询条件，不依赖库内状态是否已经刷新。*/
    public whereQuoteStatuses(
        qb: SelectQueryBuilder<Schema.TbSrmSimbankQuote>,
        statuses: Schema.TbSrmSimbankQuoteStatus[],
        now: Date
    ): void {
        const deleted = Schema.TbSrmSimbankQuoteStatus.DELETED
        qb.andWhere(
            new Brackets(scope => {
                for (const status of new Set(statuses)) {
                    if (status === Schema.TbSrmSimbankQuoteStatus.DELETED) {
                        scope.orWhere('t.status = :deleted', { deleted })
                    } else if (status === Schema.TbSrmSimbankQuoteStatus.EXPIRED) {
                        scope.orWhere('(t.status <> :deleted AND t.expiryTime IS NOT NULL AND t.expiryTime <= :now)', { deleted, now })
                    } else if (status === Schema.TbSrmSimbankQuoteStatus.EFFECTIVE) {
                        scope.orWhere(
                            '(t.status <> :deleted AND t.effectiveTime <= :now AND (t.expiryTime IS NULL OR t.expiryTime > :now))',
                            { deleted, now }
                        )
                    } else {
                        scope.orWhere(
                            '(t.status <> :deleted AND t.effectiveTime > :now AND (t.expiryTime IS NULL OR t.expiryTime > :now))',
                            { deleted, now }
                        )
                    }
                }
            })
        )
    }
}
