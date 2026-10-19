import { ApiProperty, IntersectionType, PartialType, PickType } from '@nestjs/swagger'
import { EnumsResponseDto, PageResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { PageDto } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'

/** 新增设备入参：POST /simbank/create；端口数由设备型号枚举 json.total 决定，归属人不传时为当前登录账号，状态不传时默认启用。 */
export class CreateSimbankDto extends IntersectionType(
    PickType(Schema.TbSrmSimbankDto, ['name', 'model', 'mac', 'userKeyId'] as const),
    PartialType(PickType(Schema.TbSrmSimbankDto, ['alias', 'ownerUserUid', 'status'] as const))
) {}

/** 编辑设备入参：POST /simbank/update；在线状态由设备上报维护，不允许手动修改。 */
export class UpdateSimbankDto extends IntersectionType(
    PickType(Schema.TbSrmSimbankDto, ['keyId', 'name', 'model', 'mac', 'userKeyId', 'ownerUserUid'] as const),
    PartialType(PickType(Schema.TbSrmSimbankDto, ['alias'] as const))
) {}

/** 更新设备状态入参：POST /simbank/status/update。 */
export class UpdateSimbankStatusDto extends PickType(Schema.TbSrmSimbankDto, ['keyId', 'status'] as const) {}

/** 获取设备详情入参：GET /simbank/resolve。 */
export class ResolveSimbankDto extends PickType(Schema.TbSrmSimbankDto, ['keyId'] as const) {}

/** 获取设备下拉选项入参：GET /simbank/select；name 同时模糊匹配设备名称、别名、MAC地址。 */
export class SelectSimbankDto extends PartialType(PickType(Schema.TbSrmSimbankDto, ['name', 'userKeyId'] as const)) {}

/** 分页查询设备入参：POST /simbank/column；name 同时模糊匹配设备名称、别名、MAC地址、设备ID。 */
export class ListSimbankDto extends IntersectionType(
    PageDto,
    PartialType(PickType(Schema.TbSrmSimbankDto, ['name', 'model', 'userKeyId', 'ownerUserUid', 'status', 'online'] as const))
) {}

/** 设备静态枚举响应：GET /simbank/enums；设备型号使用 Skyline 枚举 CHUNK_SRM_SIMBANK_MODEL。 */
export class SimbankEnumsResponseDto extends EnumsResponseDto({
    statusOptions: { description: '设备状态选项', example: Schema.TbSrmSimbankStatusDefinition.options },
    onlineOptions: { description: '在线状态选项', example: Schema.TbSrmSimbankOnlineDefinition.options }
}) {}

/** 设备归属供应商摘要。 */
export class SimbankUserOptionResponseDto extends PickType(Schema.TbSrmUserDto, ['keyId', 'name', 'alias'] as const) {}

/** 设备列表项及详情响应：POST /simbank/column 列表项、GET /simbank/resolve。 */
export class SimbankColumnResponseDto extends IntersectionType(Schema.TbSrmSimbankDto, feign.SkylineUserOptionsResponseDto) {
    @ApiProperty({ description: '归属供应商信息', required: false, type: SimbankUserOptionResponseDto })
    userKeyIdOptions?: SimbankUserOptionResponseDto

    @ApiProperty({ description: '归属人信息（含所属组织 organizations）', required: false, type: feign.SkylineUserOptionResponseDto })
    ownerUserUidOptions?: feign.SkylineUserOptionResponseDto
}

/** 分页查询设备响应：POST /simbank/column。 */
export class SimbankPageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '设备列表', type: [SimbankColumnResponseDto] })
    list: SimbankColumnResponseDto[]
}

/** 设备下拉选项响应：GET /simbank/select。 */
export class SimbankSelectResponseDto extends PickType(Schema.TbSrmSimbankDto, [
    'keyId',
    'name',
    'alias',
    'model',
    'mac',
    'total',
    'userKeyId',
    'status',
    'online'
] as const) {}
