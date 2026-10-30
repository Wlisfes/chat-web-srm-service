import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository, DataBaseService, Repository } from '@wlisfes/chat-web-base-schema/database'
import { PageResult, isNotEmpty, fetchResolver, fetchUntiePagination, fetchVagueKeyword } from '@wlisfes/chat-web-base-schema/utils'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { SimbankUtilsService } from '@/modules/simbank/simbank.utils.service'
import { RouteConfigEventService } from '@/modules/route/route-config-event.service'
import * as SimbankDto from '@/modules/simbank/dto/simbank.dto'
import * as Schema from '@wlisfes/chat-web-base-schema'

@Injectable()
export class SimbankService {
    constructor(
        @InjectRepository(Schema.TbSrmSimbank) private readonly repository: Repository<Schema.TbSrmSimbank>,
        private readonly database: DataBaseService,
        private readonly simbankUtilsService: SimbankUtilsService,
        @InjectRepository(Schema.TbSrmSimbankPort) private readonly portRepository: Repository<Schema.TbSrmSimbankPort>,
        @InjectRepository(Schema.TbSrmSimbankMessage) private readonly messageRepository: Repository<Schema.TbSrmSimbankMessage>,
        private readonly routeConfigEventService: RouteConfigEventService
    ) {}

    /** 设备静态枚举。 */
    public async httpBaseSrmSimbankEnums(): Promise<SimbankDto.SimbankEnumsResponseDto> {
        return {
            statusOptions: Schema.TbSrmSimbankStatusDefinition.options,
            onlineOptions: Schema.TbSrmSimbankOnlineDefinition.options
        }
    }

    /** 新增设备：端口数由设备型号决定并同步创建端口，设备别名按创建人工号自动生成，MAC 地址全表唯一，在线状态默认离线。 */
    public async httpBaseSrmCreateSimbank(principal: AuthPrincipal, input: SimbankDto.CreateSimbankDto): Promise<Schema.TbSrmSimbank> {
        const total = await this.simbankUtilsService.fetchModelTotal(input.model)
        const mac = this.simbankUtilsService.fetchNormalizeMac(input.mac)
        // 命名锁在事务提交后才释放，保证下一次生成别名时能读到已提交的序号。
        const queryRunner = await this.database.transaction()
        let lockAcquired = false
        try {
            lockAcquired = await this.simbankUtilsService.acquireCreateLock(queryRunner.manager)
            if (!lockAcquired) {
                throw new ConflictException('设备创建繁忙，请稍后重试')
            }
            const manager = queryRunner.manager
            await this.simbankUtilsService.fetchCheckUser(input.userKeyId, manager)
            await this.simbankUtilsService.fetchCheckUnique(manager, { mac })
            const simbank = await manager.save(
                manager.create(Schema.TbSrmSimbank, {
                    name: input.name.trim(),
                    alias: await this.simbankUtilsService.generateAlias(manager, principal.number),
                    model: input.model,
                    mac,
                    total,
                    userKeyId: input.userKeyId,
                    ownerUserUid: input.ownerUserUid ?? principal.uid,
                    status: input.status ?? Schema.TbSrmSimbankStatus.ENABLE,
                    online: Schema.TbSrmSimbankOnline.OFFLINE,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                })
            )
            // 按型号端口数同步初始化端口：未激活、未插卡、启用。
            await manager.insert(
                Schema.TbSrmSimbankPort,
                Array.from({ length: total }, (_, index) => ({
                    simbankKeyId: simbank.keyId,
                    port: index + 1,
                    activateStatus: Schema.TbSrmSimbankPortActivateStatus.INACTIVE,
                    insertStatus: Schema.TbSrmSimbankPortInsertStatus.REMOVED,
                    status: Schema.TbSrmSimbankPortStatus.ENABLE,
                    createBy: principal.uid,
                    modifyBy: principal.uid
                }))
            )
            await queryRunner.commitTransaction()
            return simbank
        } catch (error) {
            if (queryRunner.isTransactionActive) {
                await queryRunner.rollbackTransaction()
            }
            throw error
        } finally {
            try {
                if (lockAcquired) {
                    await this.simbankUtilsService.releaseCreateLock(queryRunner.manager)
                }
            } finally {
                await queryRunner.release()
            }
        }
    }

    /** 编辑设备：仅支持修改设备名称、设备状态；型号、MAC、端口数、归属信息创建后不可修改，在线状态由设备上报维护。 */
    public async httpBaseSrmUpdateSimbank(principal: AuthPrincipal, input: SimbankDto.UpdateSimbankDto): Promise<Schema.TbSrmSimbank> {
        const result = await this.repository.manager.transaction(async manager => {
            const simbank = await this.simbankUtilsService.findRequired(input.keyId, manager)
            manager.merge(Schema.TbSrmSimbank, simbank, {
                name: input.name.trim(),
                status: input.status,
                modifyBy: principal.uid
            })
            return await manager.save(simbank)
        })
        await this.routeConfigEventService.publish(`设备变更：keyId=${input.keyId}`)
        return result
    }

    /** 更新设备启用、停用状态。 */
    public async httpBaseSrmSimbankStatusUpdate(
        principal: AuthPrincipal,
        input: SimbankDto.UpdateSimbankStatusDto
    ): Promise<Schema.TbSrmSimbank> {
        const result = await this.repository.manager.transaction(async manager => {
            const simbank = await this.simbankUtilsService.findRequired(input.keyId, manager)
            simbank.status = input.status
            simbank.modifyBy = principal.uid
            return await manager.save(simbank)
        })
        await this.routeConfigEventService.publish(`设备状态变更：keyId=${input.keyId}`)
        return result
    }

    /** 分页查询设备，按创建时间倒序；归属供应商、归属人、创建人、更新人统一还原为 *Options。 */
    public async httpBaseSrmColumnSimbank(input: SimbankDto.ListSimbankDto): Promise<PageResult<SimbankDto.SimbankColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        return this.database.builder(this.repository, async qb => {
            if (isNotEmpty(input.name?.trim())) {
                qb.andWhere('(t.name LIKE :name OR t.alias LIKE :name OR t.mac LIKE :name OR t.keyId LIKE :name)', {
                    name: `%${input.name?.trim()}%`
                })
            }
            if (isNotEmpty(input.model)) {
                qb.andWhere('t.model = :model', { model: input.model })
            }
            if (isNotEmpty(input.userKeyId)) {
                qb.andWhere('t.userKeyId = :userKeyId', { userKeyId: input.userKeyId })
            }
            if (isNotEmpty(input.ownerUserUid)) {
                qb.andWhere('t.ownerUserUid = :ownerUserUid', { ownerUserUid: input.ownerUserUid })
            }
            if (isNotEmpty(input.status)) {
                qb.andWhere('t.status = :status', { status: input.status })
            }
            if (isNotEmpty(input.online)) {
                qb.andWhere('t.online = :online', { online: input.online })
            }
            qb.orderBy('t.createTime', 'DESC')
            qb.addOrderBy('t.keyId', 'DESC')
            qb.skip((page - 1) * size)
            qb.take(size)
            return await qb.getManyAndCount().then(async ([list, total]) => {
                await this.simbankUtilsService.fetchAppendColumnOptions(list)
                return fetchResolver({ page, size, total, list })
            })
        })
    }

    /** 获取设备详情，附带归属供应商、归属人、创建人、更新人信息。 */
    public async httpBaseSrmSimbankResolver(query: SimbankDto.ResolveSimbankDto): Promise<SimbankDto.SimbankColumnResponseDto> {
        const simbank = await this.simbankUtilsService.findRequired(query.keyId)
        await this.simbankUtilsService.fetchAppendColumnOptions([simbank])
        return simbank
    }

    /** 获取启用状态的设备下拉选项，最多 200 条。 */
    public async httpBaseSrmSelectSimbank(query: SimbankDto.SelectSimbankDto): Promise<SimbankDto.SimbankSelectResponseDto[]> {
        return this.database.builder(this.repository, async qb => {
            qb.select(['t.keyId', 't.name', 't.alias', 't.model', 't.mac', 't.total', 't.userKeyId', 't.status', 't.online'])
            qb.where('t.status = :status', { status: Schema.TbSrmSimbankStatus.ENABLE })
            if (isNotEmpty(query.userKeyId)) qb.andWhere('t.userKeyId = :userKeyId', { userKeyId: query.userKeyId })
            if (isNotEmpty(query.name?.trim())) {
                qb.andWhere('(t.name LIKE :name OR t.alias LIKE :name OR t.mac LIKE :name)', { name: `%${query.name?.trim()}%` })
            }
            qb.orderBy('t.createTime', 'DESC')
            qb.addOrderBy('t.keyId', 'DESC')
            qb.take(200)
            return await qb.getMany()
        })
    }

    /** 端口静态枚举。 */
    public async httpBaseSrmSimbankPortEnums(): Promise<SimbankDto.SimbankPortEnumsResponseDto> {
        return {
            statusOptions: Schema.TbSrmSimbankPortStatusDefinition.options,
            activateStatusOptions: Schema.TbSrmSimbankPortActivateStatusDefinition.options,
            insertStatusOptions: Schema.TbSrmSimbankPortInsertStatusDefinition.options,
            onlineOptions: Schema.TbSrmSimbankPortOnlineDefinition.options
        }
    }

    /** 更新端口启用、停用状态。端口由设备创建时初始化，不支持单独新增或删除。 */
    public async httpBaseSrmSimbankPortStatusUpdate(
        principal: AuthPrincipal,
        input: SimbankDto.UpdateSimbankPortStatusDto
    ): Promise<Schema.TbSrmSimbankPort> {
        const result = await this.portRepository.manager.transaction(async manager => {
            const port = await manager.findOneBy(Schema.TbSrmSimbankPort, { keyId: input.keyId })
            if (!port) {
                throw new NotFoundException('端口不存在')
            }
            port.status = input.status
            port.modifyBy = principal.uid
            return await manager.save(port)
        })
        await this.routeConfigEventService.publish(`端口状态变更：keyId=${input.keyId}`)
        return result
    }

    /** 分页查询端口。关键词匹配卡号和设备信息；归属供应商通过所属设备过滤。 */
    public async httpBaseSrmColumnSimbankPort(
        input: SimbankDto.ListSimbankPortDto
    ): Promise<PageResult<SimbankDto.SimbankPortColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        const keyword = input.name?.trim()
        const supplierSimbankKeyIds = isNotEmpty(input.userKeyId) ? await this.findSimbankKeyIds({ userKeyId: input.userKeyId }) : undefined
        if (supplierSimbankKeyIds?.length === 0) {
            return fetchResolver({ page, size, total: 0, list: [] })
        }
        const keywordSimbankKeyIds = keyword ? await this.findSimbankKeyIds({ keyword }) : []
        return this.database.builder(this.portRepository, async qb => {
            if (supplierSimbankKeyIds) {
                qb.andWhere('t.simbankKeyId IN (:...supplierSimbankKeyIds)', { supplierSimbankKeyIds })
            }
            if (isNotEmpty(input.simbankKeyId)) {
                qb.andWhere('t.simbankKeyId = :simbankKeyId', { simbankKeyId: input.simbankKeyId })
            }
            if (isNotEmpty(input.activateStatus)) {
                qb.andWhere('t.activateStatus = :activateStatus', { activateStatus: input.activateStatus })
            }
            if (isNotEmpty(input.countryKeyId)) {
                qb.andWhere('t.countryKeyId = :countryKeyId', { countryKeyId: input.countryKeyId })
            }
            if (isNotEmpty(input.insertStatus)) {
                qb.andWhere('t.insertStatus = :insertStatus', { insertStatus: input.insertStatus })
            }
            if (isNotEmpty(input.status)) {
                qb.andWhere('t.status = :status', { status: input.status })
            }
            if (isNotEmpty(input.online)) {
                qb.andWhere('t.online = :online', { online: input.online })
            }
            if (keyword) {
                const clauses = ['t.sim LIKE :simKeyword', 't.iccid LIKE :keyword', 't.imei LIKE :keyword']
                /**SIM 卡号码入库不带 + 号，关键字去掉开头的 + 号再匹配**/
                const params: Record<string, string | number | number[]> = {
                    keyword: `%${keyword}%`,
                    simKeyword: `%${keyword.replace(/^\+/, '')}%`
                }
                if (/^\d+$/.test(keyword)) {
                    clauses.push('t.port = :number', 't.keyId = :number')
                    params.number = Number(keyword)
                }
                if (keywordSimbankKeyIds.length > 0) {
                    clauses.push('t.simbankKeyId IN (:...keywordSimbankKeyIds)')
                    params.keywordSimbankKeyIds = keywordSimbankKeyIds
                }
                qb.andWhere(`(${clauses.join(' OR ')})`, params)
            }
            qb.orderBy('t.simbankKeyId', 'DESC')
            qb.addOrderBy('t.port', 'ASC')
            qb.skip((page - 1) * size)
            qb.take(size)
            return await qb.getManyAndCount().then(async ([list, total]) => {
                await this.simbankUtilsService.fetchAppendPortColumnOptions(list)
                return fetchResolver({ page, size, total, list })
            })
        })
    }

    /** 短信历史静态枚举。 */
    public async httpBaseSrmSimbankMessageEnums(): Promise<SimbankDto.SimbankMessageEnumsResponseDto> {
        return {
            sourceOptions: Schema.TbSrmSimbankMessageSourceDefinition.options,
            typeOptions: Schema.TbSrmSimbankMessageTypeDefinition.options,
            encodingOptions: Schema.TbSrmSimbankMessageEncodingDefinition.options,
            sendStatusOptions: Schema.TbSrmSimbankMessageSendStatusDefinition.options
        }
    }

    /** 分页查询短信历史。设备、供应商和 MCC 使用快照字段过滤。 */
    public async httpBaseSrmColumnSimbankMessage(
        input: SimbankDto.ListSimbankMessageDto
    ): Promise<PageResult<SimbankDto.SimbankMessageColumnResponseDto>> {
        const { page, size } = fetchUntiePagination(input)
        const mcc = input.mcc?.trim()
        return this.database.builder(this.messageRepository, async qb => {
            if (isNotEmpty(input.simbankKeyId)) {
                qb.andWhere('t.simbankKeyId = :simbankKeyId', { simbankKeyId: input.simbankKeyId })
            }
            if (isNotEmpty(input.userKeyId)) {
                qb.andWhere('t.userKeyId = :userKeyId', { userKeyId: input.userKeyId })
            }
            if (mcc) {
                qb.andWhere('t.mcc = :mcc', { mcc })
            }
            if (isNotEmpty(input.source)) {
                qb.andWhere('t.source = :source', { source: input.source })
            }
            if (isNotEmpty(input.type)) {
                qb.andWhere('t.type = :type', { type: input.type })
            }
            if (isNotEmpty(input.encoding)) {
                qb.andWhere('t.encoding = :encoding', { encoding: input.encoding })
            }
            if (isNotEmpty(input.sendStatus)) {
                qb.andWhere('t.sendStatus = :sendStatus', { sendStatus: input.sendStatus })
            }
            qb.orderBy('t.createTime', 'DESC')
            qb.addOrderBy('t.keyId', 'DESC')
            qb.skip((page - 1) * size)
            qb.take(size)
            return await qb.getManyAndCount().then(async ([list, total]) => {
                return fetchResolver({ page, size, total, list })
            })
        })
    }
    /** 按供应商或关键词查找设备主键，供端口列表过滤使用。 */
    private async findSimbankKeyIds(input: { userKeyId?: number; keyword?: string }): Promise<number[]> {
        return this.database.builder(this.repository, async qb => {
            qb.select('t.keyId')
            if (isNotEmpty(input.userKeyId)) {
                qb.andWhere('t.userKeyId = :userKeyId', { userKeyId: input.userKeyId })
            }
            if (input.keyword) {
                const clauses = ['t.name LIKE :keyword', 't.alias LIKE :keyword', 't.mac LIKE :keyword']
                const params: Record<string, string | number> = { keyword: `%${input.keyword}%` }
                if (/^\d+$/.test(input.keyword)) {
                    clauses.push('t.keyId = :number')
                    params.number = Number(input.keyword)
                }
                qb.andWhere(`(${clauses.join(' OR ')})`, params)
            }
            return await qb.getMany().then(list => list.map(item => item.keyId))
        })
    }

    /** 按激活方向（Skyline 国家/地区主键）对应的国际区号生成插卡模拟数据。 */
    public async httpBaseSrmSimbankPortFaker(query: SimbankDto.SimbankPortFakerQueryDto): Promise<SimbankDto.SimbankPortFakerResponseDto> {
        const dial = await this.simbankUtilsService.fetchCountryDialCode(query.countryKeyId)
        return this.simbankUtilsService.createPortCardFaker(dial)
    }

    /** 插入 SIM 卡：必须已激活，且卡号属于端口已保存激活方向的国际区号。 */
    public async httpBaseSrmSimbankPortInsert(
        principal: AuthPrincipal,
        input: SimbankDto.InsertSimbankPortDto
    ): Promise<Schema.TbSrmSimbankPort> {
        const result = await this.portRepository.manager.transaction(async manager => {
            const port = await this.findPortRequired(manager, input.keyId)
            if (port.activateStatus !== Schema.TbSrmSimbankPortActivateStatus.ACTIVE || !port.countryKeyId) {
                throw new BadRequestException('请先激活并选择激活方向')
            }
            if (port.insertStatus === Schema.TbSrmSimbankPortInsertStatus.INSERTED) {
                throw new ConflictException('端口已插入 SIM 卡')
            }
            const sim = this.simbankUtilsService.fetchNormalizeSim(input.sim)
            const dial = await this.simbankUtilsService.fetchCountryDialCode(port.countryKeyId)
            this.simbankUtilsService.fetchCardMatchesDialCode(sim, input.iccid.trim(), dial)
            const iccid = input.iccid.trim()
            const duplicated = await manager.findOneBy(Schema.TbSrmSimbankPort, { iccid })
            if (duplicated && duplicated.keyId !== port.keyId) {
                throw new ConflictException('ICCID 已存在')
            }
            port.sim = sim
            port.iccid = iccid
            port.imei = input.imei.trim()
            port.insertStatus = Schema.TbSrmSimbankPortInsertStatus.INSERTED
            port.modifyBy = principal.uid
            return await manager.save(port)
        })
        await this.routeConfigEventService.publish(`端口插卡：keyId=${input.keyId}`)
        return result
    }

    /** 先选择激活方向。未插卡也可以激活，后续插卡必须使用该方向的国际区号。 */
    public async httpBaseSrmSimbankPortActivate(
        principal: AuthPrincipal,
        input: SimbankDto.ActivateSimbankPortDto
    ): Promise<Schema.TbSrmSimbankPort> {
        const result = await this.portRepository.manager.transaction(async manager => {
            const port = await this.findPortRequired(manager, input.keyId)
            if (port.activateStatus === Schema.TbSrmSimbankPortActivateStatus.ACTIVE) {
                throw new ConflictException('SIM 卡已激活')
            }
            port.activateStatus = Schema.TbSrmSimbankPortActivateStatus.ACTIVE
            port.countryKeyId = input.countryKeyId
            port.modifyBy = principal.uid
            return await manager.save(port)
        })
        await this.routeConfigEventService.publish(`端口激活：keyId=${input.keyId}`)
        return result
    }

    /** 拔卡：清除 SIM、ICCID、IMEI，保留激活方向。 */
    public async httpBaseSrmSimbankPortRemove(
        principal: AuthPrincipal,
        input: SimbankDto.SimbankPortKeyDto
    ): Promise<Schema.TbSrmSimbankPort> {
        const result = await this.portRepository.manager.transaction(async manager => {
            const port = await this.findPortRequired(manager, input.keyId)
            if (port.insertStatus !== Schema.TbSrmSimbankPortInsertStatus.INSERTED) {
                throw new BadRequestException('端口未插入 SIM 卡')
            }
            this.clearPortCard(port, principal.uid, false)
            return await manager.save(port)
        })
        await this.routeConfigEventService.publish(`端口拔卡：keyId=${input.keyId}`)
        return result
    }

    /** 释放已激活端口：清除卡号、激活状态和激活方向；已绑定通道的端口需先解绑。 */
    public async httpBaseSrmSimbankPortRelease(
        principal: AuthPrincipal,
        input: SimbankDto.SimbankPortKeyDto
    ): Promise<Schema.TbSrmSimbankPort> {
        const result = await this.portRepository.manager.transaction(async manager => {
            const port = await this.findPortRequired(manager, input.keyId)
            if (port.activateStatus !== Schema.TbSrmSimbankPortActivateStatus.ACTIVE) {
                throw new BadRequestException('端口未激活')
            }
            // 通道只能绑定同方向的激活端口，释放会清空激活方向，必须先从通道解绑。
            if (await manager.existsBy(Schema.TbSrmChannelPort, { portKeyId: port.keyId })) {
                throw new ConflictException('端口已绑定短信通道，请先解绑')
            }
            this.clearPortCard(port, principal.uid, true)
            return await manager.save(port)
        })
        await this.routeConfigEventService.publish(`端口释放：keyId=${input.keyId}`)
        return result
    }

    /** 清除端口上的 SIM 卡信息。释放时同时清除激活状态和激活方向。 */
    private clearPortCard(port: Schema.TbSrmSimbankPort, modifyBy: string, release: boolean): void {
        port.sim = null
        port.iccid = null
        port.imei = null
        port.insertStatus = Schema.TbSrmSimbankPortInsertStatus.REMOVED
        if (release) {
            port.activateStatus = Schema.TbSrmSimbankPortActivateStatus.INACTIVE
            port.countryKeyId = null
        }
        port.modifyBy = modifyBy
    }

    /** 锁定并校验端口存在。 */
    private async findPortRequired(manager: { findOneBy: Function }, keyId: number): Promise<Schema.TbSrmSimbankPort> {
        const port = await manager.findOneBy(Schema.TbSrmSimbankPort, { keyId })
        if (!port) {
            throw new NotFoundException('端口不存在')
        }
        return port
    }
    /**
     * 按激活方向、设备归属人查询可绑定到通道的端口；不分页，只返回已激活、已插卡、尚未绑定任何通道的端口。
     * vague 模糊匹配 SIM、IMEI、ICCID；SIM 兼容传入开头的 + 号。
     */
    public async httpBaseSrmSelectSimbankPort(input: SimbankDto.ListOwnerCountryPortDto): Promise<SimbankDto.OwnerCountryPortItemDto[]> {
        return await this.simbankUtilsService.findByOwnerUserUid(input.ownerUserUid).then(async ({ simbanks, simbankOptions }) => {
            if (simbanks.length === 0) {
                return []
            }
            return this.database.builder(this.portRepository, async qb => {
                const vague = fetchVagueKeyword(input.vague)
                qb.where('t.simbankKeyId IN (:...simbankKeyIds)', {
                    simbankKeyIds: simbanks.map(item => item.keyId)
                })
                qb.andWhere('t.countryKeyId = :countryKeyId', {
                    countryKeyId: input.countryKeyId
                })
                qb.andWhere('t.activateStatus = :activateStatus', {
                    activateStatus: Schema.TbSrmSimbankPortActivateStatus.ACTIVE
                })
                qb.andWhere('t.insertStatus = :insertStatus', {
                    insertStatus: Schema.TbSrmSimbankPortInsertStatus.INSERTED
                })
                if (isNotEmpty(vague)) {
                    qb.andWhere('(t.sim LIKE :vague OR t.imei LIKE :vague OR t.iccid LIKE :vague)', {
                        vague: `%${vague}%`
                    })
                }
                await this.database.selection(qb, [
                    ['t', ['keyId', 'port', 'sim', 'imei', 'iccid']],
                    ['t', ['countryKeyId', 'simbankKeyId', 'insertStatus', 'activateStatus', 'status']]
                ])
                qb.orderBy('t.simbankKeyId', 'DESC').addOrderBy('t.port', 'ASC')
                return await qb.getMany().then(items => {
                    return items.map(item => {
                        const simbank = simbankOptions.get(item.simbankKeyId)
                        const showName = [simbank.alias, `端口[${item.port}]`].filter(isNotEmpty).join(' - ')
                        return { ...item, showName, simbankOptions: simbank }
                    })
                })
            })
        })
    }
}
