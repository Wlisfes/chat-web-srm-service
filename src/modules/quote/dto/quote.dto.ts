import { ApiProperty, IntersectionType, PartialType, PickType } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEnum, IsInt, IsNotEmpty, IsNumber } from 'class-validator'
import { IsOptional, IsString, IsUUID, MaxLength, Matches, Min } from 'class-validator'
import { EnumsResponseDto, PageResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { PageDto } from '@wlisfes/chat-web-base-schema/utils'
import { Type } from 'class-transformer'
import * as Schema from '@wlisfes/chat-web-base-schema'

/** 获取 simbank 报价静态枚举响应：GET /quote/enums。 */
export class SimbankQuoteEnumsResponseDto extends EnumsResponseDto({
    changeStatusOptions: { description: '报价变更状态选项', example: Schema.TbSrmSimbankQuoteDraftChangeStatusDefinition.options },
    draftStatusOptions: { description: '报价草稿状态选项', example: Schema.TbSrmSimbankQuoteDraftStatusDefinition.options },
    sourceOptions: { description: '报价来源选项', example: Schema.TbSrmSimbankQuoteDraftSourceDefinition.options },
    statusOptions: { description: 'simbank 报价状态选项', example: Schema.TbSrmSimbankQuoteStatusDefinition.options }
}) {}

/** 初始化simbank 报价草稿批次入参：POST /quote/draft/init。 */
export class InitSimbankQuoteDraftDto {
    @ApiProperty({ description: 'SRM 供应商主键', example: 10241000 })
    @Type(() => Number)
    @IsInt({ message: '供应商主键必须是整数' })
    @Min(1, { message: '供应商主键必须大于0' })
    userKeyId: number

    @ApiProperty({ description: 'SRM simbank 设备主键；设备必须归属该供应商', example: 100201 })
    @Type(() => Number)
    @IsInt({ message: 'simbank 设备主键必须是整数' })
    @Min(1, { message: 'simbank 设备主键必须大于0' })
    simbankKeyId: number

    @ApiProperty({ description: '国家/地区主键集合', type: [Number], example: [1, 2, 3] })
    @IsArray({ message: '国家/地区主键集合必须是数组' })
    @ArrayNotEmpty({ message: '国家/地区主键集合不能为空' })
    @ArrayMaxSize(200, { message: '单次最多选择200个国家/地区' })
    @Type(() => Number)
    @IsInt({ each: true, message: '国家/地区主键必须是整数' })
    @Min(1, { each: true, message: '国家/地区主键必须大于0' })
    countryKeyIds: number[]
}

/** 分页查询simbank 报价草稿入参：POST /quote/draft/column。 */
export class ListSimbankQuoteDraftDto extends PageDto {
    @ApiProperty({ description: '草稿批次ID', format: 'uuid', example: 'a56b8b36-1d86-4cf2-9c98-63f4134c83d0' })
    @IsUUID('4', { message: '草稿批次ID格式错误' })
    draftBatchId: string

    @ApiProperty({
        description: `${Schema.TbSrmSimbankQuoteDraftStatusDefinition.comment}；不传查询全部`,
        enum: Schema.TbSrmSimbankQuoteDraftStatus,
        enumName: 'TbSmsQuoteDraftStatus',
        required: false
    })
    @IsOptional()
    @IsEnum(Schema.TbSrmSimbankQuoteDraftStatus, { message: '报价草稿状态格式错误' })
    status?: Schema.TbSrmSimbankQuoteDraftStatus
}

/** 更新simbank 报价草稿入参：POST /quote/draft/update（只允许修改上下行费率和生效时间，可只传其中任意一个，至少传一个）。 */
export class UpdateSimbankQuoteDraftDto {
    @ApiProperty({ description: '报价草稿主键', example: 1 })
    @Type(() => Number)
    @IsInt({ message: '报价草稿主键必须是整数' })
    @Min(1, { message: '报价草稿主键必须大于0' })
    keyId: number

    @ApiProperty({
        description: '上行短信成本价USD实际金额（最多6位小数，服务端放大百万倍存储）；不传则不修改',
        required: false,
        example: 0.03
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 6 }, { message: '上行短信成本价必须是数字且最多6位小数' })
    @Min(0, { message: '上行短信成本价不能小于0' })
    upUsd?: number

    @ApiProperty({
        description: '下行短信成本价USD实际金额（最多6位小数，服务端放大百万倍存储）；不传则不修改',
        required: false,
        example: 0.05
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 6 }, { message: '下行短信成本价必须是数字且最多6位小数' })
    @Min(0, { message: '下行短信成本价不能小于0' })
    downUsd?: number

    @ApiProperty({ description: '生效时间；不传则不修改', required: false, example: '2026-08-24 00:00:00' })
    @IsOptional()
    @Matches(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/, { message: '生效时间格式错误' })
    effectiveTime?: string
}

/** 批量删除simbank 报价草稿入参：POST /quote/draft/delete。 */
export class DeleteSimbankQuoteDraftDto {
    @ApiProperty({ description: '报价草稿主键集合', type: [Number], example: [1, 2] })
    @IsArray({ message: '报价草稿主键集合必须是数组' })
    @ArrayNotEmpty({ message: '报价草稿主键集合不能为空' })
    @ArrayMaxSize(200, { message: '单次最多删除200条报价草稿' })
    @Type(() => Number)
    @IsInt({ each: true, message: '报价草稿主键必须是整数' })
    @Min(1, { each: true, message: '报价草稿主键必须大于0' })
    keyIds: number[]
}

/** 批量变更simbank 报价草稿状态入参：POST /quote/draft/status/update（删除后可恢复）。 */
export class UpdateSimbankQuoteDraftStatusDto extends IntersectionType(
    DeleteSimbankQuoteDraftDto,
    PickType(Schema.TbSrmSimbankQuoteDraftDto, ['status'])
) {}

/** 发布simbank 报价草稿批次入参：POST /quote/publish。 */
export class SimbankQuoteDraftBatchDto {
    @ApiProperty({ description: '草稿批次ID', format: 'uuid', example: 'a56b8b36-1d86-4cf2-9c98-63f4134c83d0' })
    @IsUUID('4', { message: '草稿批次ID格式错误' })
    draftBatchId: string
}

/** 分页查询正式simbank 报价入参：POST /quote/column。 */
export class ListSimbankQuoteDto extends IntersectionType(
    PageDto,
    PartialType(PickType(Schema.TbSrmSimbankQuoteDto, ['userKeyId', 'userAlias', 'simbankKeyId', 'simbankAlias', 'code', 'mcc'] as const))
) {
    @ApiProperty({
        description: '报价状态集合',
        enum: Schema.TbSrmSimbankQuoteStatus,
        isArray: true,
        required: false,
        example: [Schema.TbSrmSimbankQuoteStatus.EFFECTIVE, Schema.TbSrmSimbankQuoteStatus.PENDING]
    })
    @IsOptional()
    @IsArray({ message: '报价状态集合必须是数组' })
    @ArrayMaxSize(4, { message: '报价状态最多选择4项' })
    @IsEnum(Schema.TbSrmSimbankQuoteStatus, { each: true, message: '报价状态格式错误' })
    statuses?: Schema.TbSrmSimbankQuoteStatus[]

    @ApiProperty({ description: '国家/地区主键集合', type: [Number], required: false, example: [1, 2, 3] })
    @IsOptional()
    @IsArray({ message: '国家/地区主键集合必须是数组' })
    @ArrayMaxSize(200, { message: '国家/地区主键最多选择200项' })
    @Type(() => Number)
    @IsInt({ each: true, message: '国家/地区主键必须是整数' })
    @Min(1, { each: true, message: '国家/地区主键必须大于0' })
    countryKeyIds?: number[]
}

/** 初始化simbank 报价草稿批次响应：POST /quote/draft/init。 */
export class InitSimbankQuoteDraftResponseDto {
    @ApiProperty({ description: '草稿批次 ID', format: 'uuid', example: 'a56b8b36-1d86-4cf2-9c98-63f4134c83d0' })
    draftBatchId: string

    @ApiProperty({ description: '生成的草稿数量', example: 3 })
    total: number
}

/** 供应商摘要结构；用于正式报价 POST /quote/column 与报价草稿 POST /quote/draft/column 的 userOptions 字段。 */
export class UserOptionResponseDto {
    @ApiProperty({ description: '供应商主键', example: 10241000 })
    keyId: number

    @ApiProperty({ description: '供应商名称', example: '测试供应商' })
    name: string

    @ApiProperty({ description: '供应商别名', required: false, example: 'SSK1233A7K9' })
    alias?: string
}

/** SimbankQuoteDraftPageResponseDto.list 字段结构；分页查询simbank 报价草稿响应：POST /quote/draft/column。 */
export class SimbankQuoteDraftListItemResponseDto extends Schema.TbSrmSimbankQuoteDraftDto {
    @ApiProperty({
        description: '现行报价上行成本价USD（原价，放大百万倍存储值）；当前 simbank 无该国家报价时为 null',
        example: 30000,
        nullable: true
    })
    existingUpUsd: number | null

    @ApiProperty({
        description: '现行报价下行成本价USD（原价，放大百万倍存储值）；当前 simbank 无该国家报价时为 null',
        example: 50000,
        nullable: true
    })
    existingDownUsd: number | null

    @ApiProperty({
        description: '上行价格变更状态',
        enum: Schema.TbSrmSimbankQuoteDraftChangeStatus,
        enumName: 'TbSmsQuoteDraftChangeStatus',
        example: Schema.TbSrmSimbankQuoteDraftChangeStatus.NEW
    })
    upStatus: Schema.TbSrmSimbankQuoteDraftChangeStatus

    @ApiProperty({
        description: '下行价格变更状态',
        enum: Schema.TbSrmSimbankQuoteDraftChangeStatus,
        enumName: 'TbSmsQuoteDraftChangeStatus',
        example: Schema.TbSrmSimbankQuoteDraftChangeStatus.NEW
    })
    downStatus: Schema.TbSrmSimbankQuoteDraftChangeStatus

    @ApiProperty({
        description: '供应商信息；仅草稿分页列表返回，供应商不存在时为空',
        type: UserOptionResponseDto,
        required: false
    })
    userOptions?: UserOptionResponseDto
}

/** SimbankQuoteDraftPageResponseDto.summary 字段结构；草稿批次统计（仅有效草稿，不含软删除）。 */
export class SimbankQuoteDraftSummaryResponseDto {
    @ApiProperty({ description: '报价条目数量', example: 10 })
    total: number

    @ApiProperty({ description: '国家/地区数量', example: 10 })
    countries: number

    @ApiProperty({ description: '新增报价数量（上行或下行无现行报价）', example: 4 })
    additions: number

    @ApiProperty({ description: '涨价数量（上行或下行较现行报价增长）', example: 1 })
    increases: number

    @ApiProperty({ description: '降价数量（上行或下行较现行报价降低）', example: 1 })
    decreases: number

    @ApiProperty({ description: '定时生效数量（生效时间晚于当前时间）', example: 2 })
    scheduled: number
}

/** 分页查询simbank 报价草稿响应：POST /quote/draft/column。 */
export class SimbankQuoteDraftPageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '草稿批次统计', type: SimbankQuoteDraftSummaryResponseDto })
    summary: SimbankQuoteDraftSummaryResponseDto

    @ApiProperty({ description: '报价草稿列表', type: [SimbankQuoteDraftListItemResponseDto] })
    list: SimbankQuoteDraftListItemResponseDto[]
}

/** 发布simbank 报价草稿批次响应：POST /quote/publish。 */
export class PublishSimbankQuoteResponseDto {
    @ApiProperty({ description: '草稿批次 ID', format: 'uuid', example: 'a56b8b36-1d86-4cf2-9c98-63f4134c83d0' })
    draftBatchId: string

    @ApiProperty({ description: '已发布报价数量', example: 3 })
    published: number
}

/** SimbankQuotePageResponseDto.list 字段结构；分页查询正式simbank 报价响应：POST /quote/column。 */
export class SimbankQuoteListItemResponseDto extends Schema.TbSrmSimbankQuoteDto {
    @ApiProperty({ description: '供应商信息', type: UserOptionResponseDto, required: false })
    userOptions?: UserOptionResponseDto
}

/** 分页查询正式simbank 报价响应：POST /quote/column。 */
export class SimbankQuotePageResponseDto extends PageResponseDataDto {
    @ApiProperty({ description: '正式报价列表', type: [SimbankQuoteListItemResponseDto] })
    list: SimbankQuoteListItemResponseDto[]
}
