import { ConflictException, Injectable } from '@nestjs/common'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { InjectRepository, DataBaseService, Repository } from '@wlisfes/chat-web-base-schema/database'
import { PageResult, isNotEmpty, fetchResolver, fetchUntiePagination } from '@wlisfes/chat-web-base-schema/utils'
import { SimbankUtilsService } from '@/modules/simbank/simbank.utils.service'
import * as SimbankDto from '@/modules/simbank/dto/simbank.dto'
import * as Schema from '@wlisfes/chat-web-base-schema'

@Injectable()
export class SimbankService {
    constructor(
        @InjectRepository(Schema.TbSrmSimbank) private readonly repository: Repository<Schema.TbSrmSimbank>,
        private readonly database: DataBaseService,
        private readonly simbankUtilsService: SimbankUtilsService
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
        return this.repository.manager.transaction(async manager => {
            const simbank = await this.simbankUtilsService.findRequired(input.keyId, manager)
            manager.merge(Schema.TbSrmSimbank, simbank, {
                name: input.name.trim(),
                status: input.status,
                modifyBy: principal.uid
            })
            return await manager.save(simbank)
        })
    }

    /** 更新设备启用、停用状态。 */
    public async httpBaseSrmSimbankStatusUpdate(
        principal: AuthPrincipal,
        input: SimbankDto.UpdateSimbankStatusDto
    ): Promise<Schema.TbSrmSimbank> {
        return this.repository.manager.transaction(async manager => {
            const simbank = await this.simbankUtilsService.findRequired(input.keyId, manager)
            simbank.status = input.status
            simbank.modifyBy = principal.uid
            return await manager.save(simbank)
        })
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
}
