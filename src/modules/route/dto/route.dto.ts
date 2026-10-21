import { ApiProperty, IntersectionType, PartialType, PickType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min
} from 'class-validator'
import { EnumsResponseDto, PageResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { PageDto } from '@wlisfes/chat-web-base-schema/utils'
import * as feign from '@wlisfes/chat-web-base-schema/feign'
import * as Schema from '@wlisfes/chat-web-base-schema'

/** 路由静态枚举响应：GET /route/enums。 */
export class RouteEnumsResponseDto extends EnumsResponseDto({
    statusOptions: { description: '路由方案状态选项', example: Schema.TbSrmRouteStatusDefinition.options },
    ruleStatusOptions: { description: '路由规则状态选项', example: Schema.TbSrmRouteRuleStatusDefinition.options },
    channelStatusOptions: { description: '路由通道状态选项', example: Schema.TbSrmRouteChannelStatusDefinition.options },
    typeOptions: { description: '短信类型选项', example: Schema.TbSrmChannelTypeDefinition.options }
}) {}

/** 数量响应：批量绑定、解绑短信应用。 */
export class RouteCountResponseDto {
    @ApiProperty({ description: '处理数量', example: 2 })
    count: number
}

/* ------------------------------ 路由方案 ------------------------------ */

/** 新增路由方案入参：POST /route/create；isDefault 为 true 时取消原默认方案。 */
export class CreateRouteDto extends IntersectionType(
    PickType(Schema.TbSrmRouteDto, ['name'] as const),
    PartialType(PickType(Schema.TbSrmRouteDto, ['alias', 'isDefault', 'status', 'remark'] as const))
) {}

/** 编辑路由方案入参：POST /route/update；默认标记通过 /route/default/update 单独设置。 */
export class UpdateRouteDto extends IntersectionType(
    PickType(Schema.TbSrmRouteDto, ['keyId', 'name', 'status'] as const),
    PartialType(PickType(Schema.TbSrmRouteDto, ['alias', 'remark'] as const))
) {}

/** 路由方案主键入参：GET /route/resolve、POST /route/delete、POST /route/default/update。 */
export class RouteKeyDto extends PickType(Schema.TbSrmRouteDto, ['keyId'] as const) {}

/** 路由方案分页入参：POST /route/column；name 模糊匹配方案名称或别名。 */
export class ListRouteDto extends IntersectionType(PageDto, PartialType(PickType(Schema.TbSrmRouteDto, ['status'] as const))) {
    @ApiProperty({ description: '关键词：方案名称或别名', required: false, example: '标准' })
    @IsOptional()
    @IsString({ message: '关键词必须是字符串' })
    @MaxLength(64, { message: '关键词长度不能超过64位' })
    name?: string

    @ApiProperty({ description: '是否默认方案', required: false, example: true })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean({ message: '默认方案标记必须是布尔值' })
    isDefault?: boolean
}

/** 路由方案列表项：附带规则数和绑定短信应用数。 */
export class RouteColumnResponseDto extends IntersectionType(Schema.TbSrmRouteDto, feign.SkylineUserOptionsResponseDto) {
    @ApiProperty({ description: '规则数', example: 12 })
    ruleCount: number

    @ApiProperty({ description: '绑定的短信应用数', example: 30 })
    appCount: number
}

/** 路由方案分页响应：POST /route/column。 */
export class RoutePageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '路由方案列表', type: [RouteColumnResponseDto] })
    list: RouteColumnResponseDto[]
}

/** 路由方案下拉项：GET /route/select。 */
export class RouteSelectResponseDto extends PickType(Schema.TbSrmRouteDto, ['keyId', 'name', 'alias', 'isDefault', 'status'] as const) {}

/* ------------------------------ 路由规则 ------------------------------ */

/** 新增路由规则入参：POST /route/rule/create；同一方案内 方向 + 类型 + 运营商 + 号码段 唯一，mnc、prefix 不传表示不限。 */
export class CreateRouteRuleDto extends IntersectionType(
    PickType(Schema.TbSrmRouteRuleDto, ['routeKeyId', 'countryKeyId', 'type'] as const),
    PartialType(PickType(Schema.TbSrmRouteRuleDto, ['mnc', 'prefix', 'status', 'remark'] as const))
) {}

/** 编辑路由规则入参：POST /route/rule/update；匹配条件创建后不可修改，只能调整状态和备注。 */
export class UpdateRouteRuleDto extends IntersectionType(
    PickType(Schema.TbSrmRouteRuleDto, ['keyId', 'status'] as const),
    PartialType(PickType(Schema.TbSrmRouteRuleDto, ['remark'] as const))
) {}

/** 路由规则主键入参：POST /route/rule/delete。 */
export class RouteRuleKeyDto extends PickType(Schema.TbSrmRouteRuleDto, ['keyId'] as const) {}

/** 路由规则分页入参：POST /route/rule/column。 */
export class ListRouteRuleDto extends IntersectionType(
    PageDto,
    PickType(Schema.TbSrmRouteRuleDto, ['routeKeyId'] as const),
    PartialType(PickType(Schema.TbSrmRouteRuleDto, ['countryKeyId', 'type', 'status'] as const))
) {}

/** 路由规则列表项：附带方向、通道数和可用通道数。 */
export class RouteRuleColumnResponseDto extends IntersectionType(Schema.TbSrmRouteRuleDto, feign.SkylineUserOptionsResponseDto) {
    @ApiProperty({ description: '方向信息', required: false, type: feign.SkylineCountrySummaryResponseDto })
    countryKeyIdOptions?: feign.SkylineCountrySummaryResponseDto

    @ApiProperty({ description: '规则下的通道数', example: 3 })
    channelCount: number

    @ApiProperty({ description: '可用通道数：规则通道启用、通道启用且有启用端口', example: 2 })
    activeChannelCount: number
}

/** 路由规则分页响应：POST /route/rule/column。 */
export class RouteRulePageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '路由规则列表', type: [RouteRuleColumnResponseDto] })
    list: RouteRuleColumnResponseDto[]
}

/* ------------------------------ 规则通道 ------------------------------ */

/** 规则加入通道入参：POST /route/rule/channel/create；通道方向和类型必须与规则一致。 */
export class CreateRouteChannelDto extends IntersectionType(
    PickType(Schema.TbSrmRouteChannelDto, ['ruleKeyId', 'channelKeyId'] as const),
    PartialType(PickType(Schema.TbSrmRouteChannelDto, ['priority', 'weight', 'status'] as const))
) {}

/** 编辑规则通道入参：POST /route/rule/channel/update。 */
export class UpdateRouteChannelDto extends PickType(Schema.TbSrmRouteChannelDto, ['keyId', 'priority', 'weight', 'status'] as const) {}

/** 规则通道主键入参：POST /route/rule/channel/delete。 */
export class RouteChannelKeyDto extends PickType(Schema.TbSrmRouteChannelDto, ['keyId'] as const) {}

/** 规则通道列表入参：GET /route/rule/channel/list。 */
export class ListRouteChannelDto extends PickType(Schema.TbSrmRouteChannelDto, ['ruleKeyId'] as const) {}

/** 规则通道的通道摘要。 */
export class RouteChannelOptionDto extends PickType(Schema.TbSrmChannelDto, ['keyId', 'alias', 'type', 'countryKeyId', 'status'] as const) {
    @ApiProperty({ description: '启用的绑定端口数', example: 30 })
    enablePortCount: number
}

/** 规则通道列表项：附带通道信息、是否可用和同优先级内分流占比。 */
export class RouteChannelResponseDto extends Schema.TbSrmRouteChannelDto {
    @ApiProperty({ description: '通道信息', required: false, type: RouteChannelOptionDto })
    channelOptions?: RouteChannelOptionDto

    @ApiProperty({ description: '是否可用：规则通道启用、通道启用且有启用端口', example: true })
    active: boolean

    @ApiProperty({ description: '同优先级内的分流占比（百分比，只统计可用通道）', example: 60 })
    ratio: number
}

/* ------------------------------ 短信应用绑定 ------------------------------ */

/** 短信应用绑定方案入参：POST /route/app/bind；已绑定其他方案的应用会改绑到当前方案。 */
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

/** 解绑短信应用入参：POST /route/app/unbind；解绑后应用走默认方案。 */
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

/** 短信应用绑定列表项：附带短信应用、客户和方案信息。 */
export class RouteAppColumnResponseDto extends IntersectionType(Schema.TbSrmRouteAppDto, feign.SkylineUserOptionsResponseDto) {
    @ApiProperty({ description: '短信应用信息', required: false, type: feign.SmsAppSummaryResponseDto })
    appKeyIdOptions?: feign.SmsAppSummaryResponseDto

    @ApiProperty({ description: '客户信息', required: false, type: RouteUserOptionDto })
    userKeyIdOptions?: RouteUserOptionDto

    @ApiProperty({ description: '方案信息', required: false, type: RouteSelectResponseDto })
    routeKeyIdOptions?: RouteSelectResponseDto
}

/** 短信应用绑定分页响应：POST /route/app/column。 */
export class RouteAppPageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '短信应用绑定列表', type: [RouteAppColumnResponseDto] })
    list: RouteAppColumnResponseDto[]
}

/* ------------------------------ 选路预览 ------------------------------ */

/** 选路预览入参：POST /route/preview；type 不传时使用短信应用类型。 */
export class RoutePreviewDto extends PickType(Schema.TbSrmRouteAppDto, ['appKeyId'] as const) {
    @ApiProperty({ description: '收件号码：含国际区号，可带 + 或 00 前缀', example: '+85291234567' })
    @IsString({ message: '收件号码必须是字符串' })
    @Matches(/^(\+|00)?\d{6,20}$/, { message: '收件号码格式错误，需包含国际区号' })
    phone: string

    @ApiProperty({ description: '运营商 MNC：不传时只匹配不限运营商的规则', required: false, example: '' })
    @IsOptional()
    @Matches(/^(\d{2,3})?$/, { message: '运营商MNC必须是2-3位数字或为空' })
    mnc?: string

    @ApiProperty({ description: '短信类型：不传时使用短信应用类型', required: false, enum: Schema.TbSrmChannelType })
    @IsOptional()
    @IsEnum(Schema.TbSrmChannelType, { message: '短信类型格式错误' })
    type?: Schema.TbSrmChannelType
}

/** 选路预览命中的规则。 */
export class RoutePreviewRuleDto extends Schema.TbSrmRouteRuleDto {
    @ApiProperty({ description: '方向信息', required: false, type: feign.SkylineCountrySummaryResponseDto })
    countryKeyIdOptions?: feign.SkylineCountrySummaryResponseDto
}

/** 选路预览通道：selected 表示本次实际参与分流的优先级档位。 */
export class RoutePreviewChannelDto extends RouteChannelResponseDto {
    @ApiProperty({ description: '是否参与本次分流：当前最高可用优先级内的可用通道', example: true })
    selected: boolean
}

/** 选路预览响应：POST /route/preview。 */
export class RoutePreviewResponseDto {
    @ApiProperty({ description: '是否找到可用通道', example: true })
    matched: boolean

    @ApiProperty({ description: '选路说明', example: '命中方案【标准线路】规则：852 / 验证码' })
    message: string

    @ApiProperty({ description: '本次选路使用的短信类型', enum: Schema.TbSrmChannelType })
    type: Schema.TbSrmChannelType

    @ApiProperty({ description: '标准化后的收件号码（不含 + 和 00）', example: '85291234567' })
    phone: string

    @ApiProperty({ description: '短信应用信息', type: feign.SmsAppSummaryResponseDto })
    appOptions: feign.SmsAppSummaryResponseDto

    @ApiProperty({ description: '是否回落到默认方案', example: false })
    fallback: boolean

    @ApiProperty({ description: '命中的方案', required: false, type: RouteSelectResponseDto })
    routeOptions?: RouteSelectResponseDto

    @ApiProperty({ description: '命中的规则', required: false, type: RoutePreviewRuleDto })
    ruleOptions?: RoutePreviewRuleDto

    @ApiProperty({ description: '命中规则下的全部通道', type: [RoutePreviewChannelDto] })
    channels: RoutePreviewChannelDto[]
}
