import { ApiProperty, IntersectionType, PartialType, PickType } from '@nestjs/swagger'
import { EnumsResponseDto, PageResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { PageDto, VagueDto } from '@wlisfes/chat-web-base-schema/utils'
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator'
import { Type } from 'class-transformer'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'

/** 新增设备入参：POST /simbank/create；端口数由设备型号枚举 json.total 决定，设备别名由服务端按创建人工号生成，归属人不传时为当前登录账号，状态不传时默认启用。 */
export class CreateSimbankDto extends IntersectionType(
    PickType(Schema.TbSrmSimbankDto, ['name', 'model', 'mac', 'userKeyId'] as const),
    PartialType(PickType(Schema.TbSrmSimbankDto, ['ownerUserUid', 'status'] as const))
) {}

/** 编辑设备入参：POST /simbank/update；仅支持修改设备名称、设备状态。 */
export class UpdateSimbankDto extends PickType(Schema.TbSrmSimbankDto, ['keyId', 'name', 'status'] as const) {}

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

/** 端口关键词：同时模糊匹配 SIM、ICCID、IMEI，纯数字时同时精确匹配端口编号、端口ID、设备ID。 */
class SimbankPortKeywordDto {
    @ApiProperty({
        description: '关键词：SIM、ICCID、IMEI、端口编号、端口ID、设备名称、别名、MAC或设备ID',
        required: false,
        example: '898600'
    })
    @IsOptional()
    @IsString({ message: '关键词必须是字符串' })
    @MaxLength(64, { message: '关键词长度不能超过64位' })
    name?: string

    @ApiProperty({ description: '归属供应商：按所属设备的供应商主键过滤', required: false, example: 10241000 })
    @IsOptional()
    @Type(() => Number)
    @IsInt({ message: '归属供应商必须是整数' })
    @Min(1, { message: '归属供应商必须大于0' })
    userKeyId?: number
}

/** 分页查询端口入参：POST /simbank/port/column。 */
export class ListSimbankPortDto extends IntersectionType(
    PageDto,
    PartialType(PickType(Schema.TbSrmSimbankPortDto, ['simbankKeyId', 'countryKeyId'] as const)),
    PartialType(PickType(Schema.TbSrmSimbankPortDto, ['activateStatus', 'insertStatus', 'status'] as const)),
    SimbankPortKeywordDto
) {}

/** 更新端口状态入参：POST /simbank/port/status/update。 */
export class UpdateSimbankPortStatusDto extends PickType(Schema.TbSrmSimbankPortDto, ['keyId', 'status'] as const) {}

/** 端口静态枚举响应：GET /simbank/port/enums。 */
export class SimbankPortEnumsResponseDto extends EnumsResponseDto({
    statusOptions: { description: '端口状态选项', example: Schema.TbSrmSimbankPortStatusDefinition.options },
    activateStatusOptions: { description: '激活状态选项', example: Schema.TbSrmSimbankPortActivateStatusDefinition.options },
    insertStatusOptions: { description: '插卡状态选项', example: Schema.TbSrmSimbankPortInsertStatusDefinition.options }
}) {}

/** 端口所属设备摘要。 */
export class SimbankPortDeviceOptionResponseDto extends IntersectionType(
    PickType(Schema.TbSrmSimbankDto, ['keyId', 'name', 'alias', 'model', 'mac'] as const),
    PickType(Schema.TbSrmSimbankDto, ['total', 'userKeyId', 'ownerUserUid', 'status', 'online'] as const),
    feign.SkylineUserOptionsResponseDto
) {
    @ApiProperty({ description: '归属供应商信息', required: false, type: SimbankUserOptionResponseDto })
    userKeyIdOptions?: SimbankUserOptionResponseDto

    @ApiProperty({ description: '归属人信息（含所属组织 organizations）', required: false, type: feign.SkylineUserOptionResponseDto })
    ownerUserUidOptions?: feign.SkylineUserOptionResponseDto
}

/** 端口列表项响应：POST /simbank/port/column。 */
export class SimbankPortColumnResponseDto extends IntersectionType(Schema.TbSrmSimbankPortDto, feign.SkylineUserOptionsResponseDto) {
    @ApiProperty({ description: '所属设备信息', required: false, type: SimbankPortDeviceOptionResponseDto })
    simbankOptions?: SimbankPortDeviceOptionResponseDto
}

/** 分页查询端口响应：POST /simbank/port/column。 */
export class SimbankPortPageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '端口列表', type: [SimbankPortColumnResponseDto] })
    list: SimbankPortColumnResponseDto[]
}

/** 插卡模拟卡数据。 */
export class SimbankPortCardDto {
    @ApiProperty({ description: 'SIM 卡号码：国际区号 + 号码，不带 + 号；兼容传入开头的 + 号，入库前会去除', example: '8613800138000' })
    @IsString({ message: 'SIM 卡号码必须是字符串' })
    @IsNotEmpty({ message: 'SIM 卡号码必填' })
    @MaxLength(32, { message: 'SIM 卡号码长度不能超过32位' })
    @Matches(/^\+?[0-9]{8,31}$/, { message: 'SIM 卡号码格式错误' })
    sim: string

    @ApiProperty({ description: 'ICCID：SIM 卡唯一编号', example: '89860012345678901234' })
    @IsString({ message: 'ICCID 必须是字符串' })
    @Matches(/^[0-9]{18,22}$/, { message: 'ICCID 格式错误' })
    iccid: string

    @ApiProperty({ description: 'IMEI：端口模块识别码', example: '860000000000000' })
    @IsString({ message: 'IMEI 必须是字符串' })
    @Matches(/^[0-9]{15}$/, { message: 'IMEI 格式错误' })
    imei: string
}

/** 激活方向。 */
export class ActivateSimbankPortCountryDto {
    @ApiProperty({ description: '激活方向：Skyline 国家/地区主键', example: 1024 })
    @Type(() => Number)
    @IsInt({ message: '激活方向必须是整数' })
    @Min(1, { message: '激活方向必须大于0' })
    countryKeyId: number
}

/** 插卡模拟数据入参：GET /simbank/port/faker。countryKeyId 为激活方向（Skyline 国家/地区主键），服务端按其国际区号生成卡号。 */
export class SimbankPortFakerQueryDto extends ActivateSimbankPortCountryDto {}

/** 插卡模拟数据响应：GET /simbank/port/faker。 */
export class SimbankPortFakerResponseDto extends SimbankPortCardDto {}

/** 插入 SIM 卡入参：POST /simbank/port/insert。 */
export class InsertSimbankPortDto extends IntersectionType(PickType(Schema.TbSrmSimbankPortDto, ['keyId'] as const), SimbankPortCardDto) {}

/** 激活 SIM 卡入参：POST /simbank/port/activate。 */
export class ActivateSimbankPortDto extends IntersectionType(
    PickType(Schema.TbSrmSimbankPortDto, ['keyId'] as const),
    ActivateSimbankPortCountryDto
) {}

/** 端口主键入参：POST /simbank/port/remove、POST /simbank/port/release。 */
export class SimbankPortKeyDto extends PickType(Schema.TbSrmSimbankPortDto, ['keyId'] as const) {}

/** 短信历史关键词。 */
class SimbankMessageKeywordDto {
    @ApiProperty({
        description: '关键词：发送号码、接收号码、内容、SIM、ICCID、任务、设备、通道、供应商或状态码',
        required: false,
        example: '86138'
    })
    @IsOptional()
    @IsString({ message: '关键词必须是字符串' })
    @MaxLength(64, { message: '关键词长度不能超过64位' })
    name?: string
}

/** 分页查询短信历史入参：POST /simbank/message/column。 */
export class ListSimbankMessageDto extends IntersectionType(
    PageDto,
    PartialType(
        PickType(Schema.TbSrmSimbankMessageDto, [
            'simbankKeyId',
            'userKeyId',
            'countryKeyId',
            'source',
            'type',
            'encoding',
            'sendStatus'
        ] as const)
    ),
    SimbankMessageKeywordDto
) {}

/** 短信历史静态枚举响应：GET /simbank/message/enums。 */
export class SimbankMessageEnumsResponseDto extends EnumsResponseDto({
    sourceOptions: { description: '上下行选项', example: Schema.TbSrmSimbankMessageSourceDefinition.options },
    typeOptions: { description: '短信类型选项', example: Schema.TbSrmSimbankMessageTypeDefinition.options },
    encodingOptions: { description: '编码方式选项', example: Schema.TbSrmSimbankMessageEncodingDefinition.options },
    sendStatusOptions: { description: '发送状态选项', example: Schema.TbSrmSimbankMessageSendStatusDefinition.options }
}) {}

/** 短信历史列表项：POST /simbank/message/column。 */
export class SimbankMessageColumnResponseDto extends Schema.TbSrmSimbankMessageDto {
    @ApiProperty({ description: '归属人信息', required: false, type: feign.SkylineUserOptionResponseDto })
    ownerUserUidOptions?: feign.SkylineUserOptionResponseDto

    @ApiProperty({ description: '通道负责人信息', required: false, type: feign.SkylineUserOptionResponseDto })
    channelOwnerUserUidOptions?: feign.SkylineUserOptionResponseDto
}

/** 分页查询短信历史响应：POST /simbank/message/column。 */
export class SimbankMessagePageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '短信历史列表', type: [SimbankMessageColumnResponseDto] })
    list: SimbankMessageColumnResponseDto[]
}

/** 按方向和归属人查询端口入参：POST /simbank/port/select。 */
export class ListOwnerCountryPortDto extends IntersectionType(
    PickType(Schema.TbSrmSimbankPortDto, ['countryKeyId'] as const),
    PickType(Schema.TbSrmChannelDto, ['ownerUserUid'] as const),
    VagueDto
) {}

/** 可绑定端口所属设备摘要。 */
export class OwnerCountryPortSimbankDto extends PickType(Schema.TbSrmSimbankDto, [
    'keyId',
    'alias',
    'name',
    'mac',
    'model',
    'status',
    'online'
] as const) {}

/** 按方向和归属人查询到的可绑定端口，附带所属设备信息。 */
export class OwnerCountryPortItemDto extends PickType(Schema.TbSrmSimbankPortDto, [
    'keyId',
    'port',
    'sim',
    'imei',
    'iccid',
    'countryKeyId',
    'simbankKeyId',
    'insertStatus',
    'activateStatus',
    'status'
] as const) {
    @ApiProperty({ description: '所属设备信息', required: false, type: OwnerCountryPortSimbankDto })
    simbankOptions?: OwnerCountryPortSimbankDto

    @ApiProperty({ description: '下拉展示：设备别名 - 端口号', example: 'SSK1024SMSA001 - 端口[1]' })
    showName: string
}
