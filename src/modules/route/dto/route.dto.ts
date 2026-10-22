import { ApiProperty, IntersectionType, PartialType, PickType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { EnumsResponseDto, PageResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { PageDto } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'

/** 路由静态枚举响应：GET /route/enums。 */
export class RouteEnumsResponseDto extends EnumsResponseDto({
    statusOptions: { description: '路由状态选项', example: Schema.TbSrmRouteStatusDefinition.options },
    routeTypeOptions: { description: '路由类型选项', example: Schema.TbSrmRouteTypeDefinition.options },
    channelStatusOptions: { description: '路由通道状态选项', example: Schema.TbSrmRouteChannelStatusDefinition.options },
    ruleStatusOptions: { description: '规则组状态选项', example: Schema.TbSrmRouteRuleStatusDefinition.options },
    ruleFieldOptions: { description: '条件字段选项', example: Schema.TbSrmRouteRuleFieldDefinition.options },
    ruleOperatorOptions: { description: '条件操作符选项', example: Schema.TbSrmRouteRuleOperatorDefinition.options },
    typeOptions: { description: '短信类型选项', example: Schema.TbSmsAppTypeDefinition.options }
}) {}

/** 数量响应：批量绑定、解绑短信应用。 */
export class RouteCountResponseDto {
    @ApiProperty({ description: '处理数量', example: 2 })
    count: number
}

/* ------------------------------ 路由 ------------------------------ */

/** 新增路由入参：POST /route/create；别名按 LSK + 归属人工号 + 路由类型 + 分段序号自动生成，类型创建后不可修改。 */
export class CreateRouteDto extends IntersectionType(
    PickType(Schema.TbSrmRouteDto, ['name', 'type'] as const),
    PartialType(PickType(Schema.TbSrmRouteDto, ['priority', 'status', 'ownerUserUid', 'remark'] as const))
) {}

/** 编辑路由入参：POST /route/update；只能修改名称、优先级、状态和备注。 */
export class UpdateRouteDto extends IntersectionType(
    PickType(Schema.TbSrmRouteDto, ['keyId', 'name', 'status'] as const),
    PartialType(PickType(Schema.TbSrmRouteDto, ['priority', 'remark'] as const))
) {}

/** 路由主键入参：GET /route/resolve、POST /route/delete。 */
export class RouteKeyDto extends PickType(Schema.TbSrmRouteDto, ['keyId'] as const) {}

/** 路由分页入参：POST /route/column；name 模糊匹配路由名称或别名。 */
export class ListRouteDto extends IntersectionType(PageDto, PartialType(PickType(Schema.TbSrmRouteDto, ['type', 'status'] as const))) {
    @ApiProperty({ description: '关键词：路由名称或别名', required: false, example: '标准' })
    @IsOptional()
    @IsString({ message: '关键词必须是字符串' })
    @MaxLength(64, { message: '关键词长度不能超过64位' })
    name?: string
}

/** 路由覆盖的 方向 + 类型。 */
export class RouteCoverageDto {
    @ApiProperty({ description: '方向：Skyline 国家/地区主键', example: 1007 })
    countryKeyId: number

    @ApiProperty({ description: '短信类型', enum: Schema.TbSmsAppType, example: Schema.TbSmsAppType.MRKT })
    type: Schema.TbSmsAppType

    @ApiProperty({ description: '方向信息', required: false, type: feign.SkylineCountrySummaryResponseDto })
    countryKeyIdOptions?: feign.SkylineCountrySummaryResponseDto

    @ApiProperty({ description: '该方向和类型下的通道数', example: 3 })
    channelCount: number

    @ApiProperty({ description: '该方向和类型下的可用通道数', example: 2 })
    activeChannelCount: number
}

/** 路由列表项：附带规则摘要、通道数、可用通道数、覆盖的方向和类型、绑定短信应用数。 */
export class RouteColumnResponseDto extends IntersectionType(Schema.TbSrmRouteDto, feign.SkylineUserOptionsResponseDto) {
    @ApiProperty({ description: '启用的规则组数：为 0 时路由不接收任何短信', example: 2 })
    ruleCount: number

    @ApiProperty({
        description: '规则摘要：启用的规则组之间是“或”，组内条件之间是“且”',
        example: '(方向 属于 中国 且 类型 属于 MRKT) 或 (号码段 以 85291 开头)'
    })
    ruleSummary: string

    @ApiProperty({ description: '通道数', example: 6 })
    channelCount: number

    @ApiProperty({ description: '可用通道数：路由通道启用、通道启用且有启用端口', example: 5 })
    activeChannelCount: number

    @ApiProperty({ description: '覆盖的方向和类型，由路由下的通道决定', type: [RouteCoverageDto] })
    coverages: RouteCoverageDto[]

    @ApiProperty({ description: '绑定的短信应用数', example: 30 })
    appCount: number

    @ApiProperty({ description: '归属人信息', required: false, type: feign.SkylineUserOptionResponseDto })
    ownerUserUidOptions?: feign.SkylineUserOptionResponseDto
}

/** 路由分页响应：POST /route/column。 */
export class RoutePageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '路由列表', type: [RouteColumnResponseDto] })
    list: RouteColumnResponseDto[]
}

/** 路由下拉项：GET /route/select。 */
export class RouteSelectResponseDto extends PickType(Schema.TbSrmRouteDto, [
    'keyId',
    'name',
    'alias',
    'type',
    'priority',
    'status'
] as const) {}

/* ------------------------------ 规则组 ------------------------------ */

/** 新增规则组入参：POST /route/rule/create。 */
export class CreateRouteRuleDto extends IntersectionType(
    PickType(Schema.TbSrmRouteRuleDto, ['routeKeyId', 'conditions'] as const),
    PartialType(PickType(Schema.TbSrmRouteRuleDto, ['sort', 'status', 'remark'] as const))
) {}

/** 编辑规则组入参：POST /route/rule/update；可修改排序、条件、状态和备注。 */
export class UpdateRouteRuleDto extends IntersectionType(
    PickType(Schema.TbSrmRouteRuleDto, ['keyId', 'conditions', 'status'] as const),
    PartialType(PickType(Schema.TbSrmRouteRuleDto, ['sort', 'remark'] as const))
) {}

/** 规则组主键入参：POST /route/rule/delete。 */
export class RouteRuleKeyDto extends PickType(Schema.TbSrmRouteRuleDto, ['keyId'] as const) {}

/** 规则组列表入参：GET /route/rule/list。 */
export class ListRouteRuleDto extends PickType(Schema.TbSrmRouteRuleDto, ['routeKeyId'] as const) {}

/** 规则组列表项：附带规则组的中文描述。 */
export class RouteRuleResponseDto extends Schema.TbSrmRouteRuleDto {
    @ApiProperty({ description: '规则组描述', example: '方向 属于 中国 且 类型 属于 MRKT' })
    description: string
}

/* ------------------------------ 路由通道 ------------------------------ */

/** 更新路由通道绑定入参：POST /route/channel/bind；以本次提交的集合为准，路由可以挂不同方向和类型的通道。 */
export class BindRouteChannelDto extends IntersectionType(
    PickType(Schema.TbSrmRouteChannelDto, ['routeKeyId'] as const),
    PartialType(PickType(Schema.TbSrmRouteChannelDto, ['priority', 'weight', 'status'] as const))
) {
    @ApiProperty({ description: '通道ID集合：以本次提交的集合为准更新路由通道绑定', type: Number, isArray: true, example: [1001] })
    @IsArray({ message: '通道集合必须是数组' })
    @ArrayNotEmpty({ message: '请选择通道' })
    @ArrayMaxSize(100, { message: '单次最多加入100个通道' })
    @Type(() => Number)
    @IsInt({ each: true, message: '通道ID必须是整数' })
    @Min(1, { each: true, message: '通道ID必须大于0' })
    channelKeyIds: number[]
}

/** 编辑路由通道入参：POST /route/channel/update。 */
export class UpdateRouteChannelDto extends PickType(Schema.TbSrmRouteChannelDto, ['keyId', 'priority', 'weight', 'status'] as const) {}

/** 路由通道主键入参：POST /route/channel/delete。 */
export class RouteChannelKeyDto extends PickType(Schema.TbSrmRouteChannelDto, ['keyId'] as const) {}

/** 路由通道列表入参：GET /route/channel/list。 */
export class ListRouteChannelDto extends PickType(Schema.TbSrmRouteChannelDto, ['routeKeyId'] as const) {}

/** 路由通道的通道摘要。 */
export class RouteChannelOptionDto extends PickType(Schema.TbSrmChannelDto, ['keyId', 'alias', 'type', 'countryKeyId', 'status'] as const) {
    @ApiProperty({ description: '启用的绑定端口数', example: 30 })
    enablePortCount: number

    @ApiProperty({ description: '方向信息', required: false, type: feign.SkylineCountrySummaryResponseDto })
    countryKeyIdOptions?: feign.SkylineCountrySummaryResponseDto
}

/** 路由通道列表项：附带通道信息、是否可用和分流占比。 */
export class RouteChannelResponseDto extends Schema.TbSrmRouteChannelDto {
    @ApiProperty({ description: '通道信息', required: false, type: RouteChannelOptionDto })
    channelOptions?: RouteChannelOptionDto

    @ApiProperty({ description: '是否可用：路由通道启用、通道启用且有启用端口', example: true })
    active: boolean

    @ApiProperty({ description: '分流占比：同一路由内同方向、同类型、同优先级的可用通道之间按权重计算（百分比）', example: 60 })
    ratio: number
}

/* ------------------------------ 短信应用绑定 ------------------------------ */

/** 短信应用绑定路由入参：POST /route/app/bind；只能绑定同类型路由，已绑定其他路由的应用会改绑到当前路由。 */
export class BindRouteAppDto extends PickType(Schema.TbSrmRouteAppDto, ['routeKeyId'] as const) {
    @ApiProperty({ description: '短信应用主键集合', type: Number, isArray: true, example: [1001, 1002] })
    @IsArray({ message: '短信应用集合必须是数组' })
    @ArrayNotEmpty({ message: '请选择短信应用' })
    @ArrayMaxSize(100, { message: '单次最多绑定100个短信应用' })
    @Type(() => Number)
    @IsInt({ each: true, message: '短信应用主键必须是整数' })
    @Min(1, { each: true, message: '短信应用主键必须大于0' })
    appKeyIds: number[]
}

/** 解绑短信应用入参：POST /route/app/unbind；解绑后应用按优先级使用同类型路由。 */
export class UnbindRouteAppDto {
    @ApiProperty({ description: '绑定记录主键集合', type: Number, isArray: true, example: [1] })
    @IsArray({ message: '绑定记录集合必须是数组' })
    @ArrayNotEmpty({ message: '请选择要解绑的短信应用' })
    @ArrayMaxSize(100, { message: '单次最多解绑100个短信应用' })
    @Type(() => Number)
    @IsInt({ each: true, message: '绑定记录主键必须是整数' })
    @Min(1, { each: true, message: '绑定记录主键必须大于0' })
    keyIds: number[]
}

/** 短信应用绑定分页入参：POST /route/app/column。 */
export class ListRouteAppDto extends IntersectionType(
    PageDto,
    PartialType(PickType(Schema.TbSrmRouteAppDto, ['routeKeyId', 'userKeyId', 'appKeyId'] as const))
) {}

/** 客户摘要。 */
export class RouteUserOptionDto {
    @ApiProperty({ description: '客户主键', example: 10241000 })
    keyId: number

    @ApiProperty({ description: '客户名称', required: false, example: '测试客户' })
    name?: string

    @ApiProperty({ description: '客户别名', required: false, example: 'RCK1024A7K9' })
    alias?: string
}

/** 短信应用绑定列表项：附带短信应用、客户和路由信息。 */
export class RouteAppColumnResponseDto extends IntersectionType(Schema.TbSrmRouteAppDto, feign.SkylineUserOptionsResponseDto) {
    @ApiProperty({ description: '短信应用信息', required: false, type: feign.SmsAppSummaryResponseDto })
    appKeyIdOptions?: feign.SmsAppSummaryResponseDto

    @ApiProperty({ description: '客户信息', required: false, type: RouteUserOptionDto })
    userKeyIdOptions?: RouteUserOptionDto

    @ApiProperty({ description: '路由信息', required: false, type: RouteSelectResponseDto })
    routeKeyIdOptions?: RouteSelectResponseDto
}

/** 短信应用绑定分页响应：POST /route/app/column。 */
export class RouteAppPageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '短信应用绑定列表', type: [RouteAppColumnResponseDto] })
    list: RouteAppColumnResponseDto[]
}

/* ------------------------------ 选路预览 ------------------------------ */

/** 选路预览入参：POST /route/preview；type 不传时使用短信应用类型，phone 用于号码段条件。 */
export class RoutePreviewDto extends PickType(Schema.TbSrmRouteAppDto, ['appKeyId'] as const) {
    @ApiProperty({
        description: '收件号码：含国际区号，可带 + 号；不传时“以…开头”条件不满足、“不以…开头”条件满足',
        required: false,
        example: '85291234567'
    })
    @IsOptional()
    @IsString({ message: '收件号码必须是字符串' })
    @MaxLength(24, { message: '收件号码长度不能超过24位' })
    phone?: string

    @ApiProperty({ description: '方向：Skyline 国家/地区主键', example: 1007 })
    @Type(() => Number)
    @IsInt({ message: '方向必须是整数' })
    @Min(1, { message: '方向必须大于0' })
    countryKeyId: number

    @ApiProperty({ description: '短信类型：不传时使用短信应用类型', required: false, enum: Schema.TbSmsAppType })
    @IsOptional()
    @IsEnum(Schema.TbSmsAppType, { message: '短信类型格式错误' })
    type?: Schema.TbSmsAppType
}

/** 选路预览通道：selected 表示本次实际参与分流的通道。 */
export class RoutePreviewChannelDto extends RouteChannelResponseDto {
    @ApiProperty({ description: '是否参与本次分流：当前最高可用优先级内的可用通道', example: true })
    selected: boolean
}

/** 选路预览中每条被尝试的路由。 */
export class RoutePreviewStepDto {
    @ApiProperty({ description: '路由信息', type: RouteSelectResponseDto })
    routeOptions: RouteSelectResponseDto

    @ApiProperty({ description: '是否通过规则进入该路由', example: true })
    admitted: boolean

    @ApiProperty({ description: '命中的规则组描述，没有进入路由时为空', required: false, example: '方向 属于 中国香港' })
    ruleDescription?: string

    @ApiProperty({ description: '该路由内与方向和类型一致的通道，没有进入路由时为空', type: [RoutePreviewChannelDto] })
    channels: RoutePreviewChannelDto[]

    @ApiProperty({ description: '是否命中：进入路由且有可用通道', example: true })
    matched: boolean
}

/** 选路预览响应：POST /route/preview。 */
export class RoutePreviewResponseDto {
    @ApiProperty({ description: '是否找到可用通道', example: true })
    matched: boolean

    @ApiProperty({ description: '选路说明', example: '命中绑定路由【大客户线路】' })
    message: string

    @ApiProperty({ description: '本次选路使用的短信类型', enum: Schema.TbSmsAppType })
    type: Schema.TbSmsAppType

    @ApiProperty({ description: '短信应用信息', type: feign.SmsAppSummaryResponseDto })
    appOptions: feign.SmsAppSummaryResponseDto

    @ApiProperty({ description: '是否回落到其他同类型路由', example: false })
    fallback: boolean

    @ApiProperty({
        description: '按顺序尝试的路由：绑定的同类型路由在前，其他同类型路由按优先级在后，直到命中为止',
        type: [RoutePreviewStepDto]
    })
    steps: RoutePreviewStepDto[]
}
