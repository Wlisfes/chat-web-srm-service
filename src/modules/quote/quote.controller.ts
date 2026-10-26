import { Body, Get, Post } from '@nestjs/common'
import { AffectedResponseDataDto, ApiServiceDecorator, ApifoxController } from '@wlisfes/chat-web-base-schema/decorator'
import { type AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { CurrentPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { SimbankQuoteService } from '@/modules/quote/quote.service'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as SimbankQuoteDto from '@/modules/quote/dto/quote.dto'

@ApifoxController('供应商关系管理-simbank 报价', 'quote', { bearerAuth: true })
export class SimbankQuoteController {
    constructor(private readonly simbankQuoteService: SimbankQuoteService) {}

    @ApiServiceDecorator(Get('enums'), {
        operation: { summary: '获取simbank 报价静态枚举' },
        response: { type: SimbankQuoteDto.SimbankQuoteEnumsResponseDto, description: 'simbank 报价静态枚举' }
    })
    public async httpBaseSrmSimbankQuoteEnums(): Promise<SimbankQuoteDto.SimbankQuoteEnumsResponseDto> {
        return this.simbankQuoteService.httpBaseSrmSimbankQuoteEnums()
    }

    @ApiServiceDecorator(Post('draft/init'), {
        operation: { summary: '初始化simbank 报价草稿批次' },
        request: { source: 'body', type: SimbankQuoteDto.InitSimbankQuoteDraftDto },
        response: { type: SimbankQuoteDto.InitSimbankQuoteDraftResponseDto, description: '草稿批次信息' }
    })
    public async httpBaseSrmSimbankInitQuoteDraft(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() body: SimbankQuoteDto.InitSimbankQuoteDraftDto
    ): Promise<SimbankQuoteDto.InitSimbankQuoteDraftResponseDto> {
        return this.simbankQuoteService.httpBaseSrmSimbankInitQuoteDraft(principal, body)
    }

    @ApiServiceDecorator(Post('draft/column'), {
        operation: { summary: '分页查询simbank 报价草稿' },
        request: { source: 'body', type: SimbankQuoteDto.ListSimbankQuoteDraftDto },
        response: { type: SimbankQuoteDto.SimbankQuoteDraftPageResponseDto, description: '报价草稿分页数据' }
    })
    public async httpBaseSrmSimbankColumnQuoteDraft(@Body() body: SimbankQuoteDto.ListSimbankQuoteDraftDto) {
        return this.simbankQuoteService.httpBaseSrmSimbankColumnQuoteDraft(body)
    }

    @ApiServiceDecorator(Post('draft/update'), {
        operation: { summary: '更新simbank 报价草稿' },
        request: { source: 'body', type: SimbankQuoteDto.UpdateSimbankQuoteDraftDto },
        response: { type: SimbankQuoteDto.SimbankQuoteDraftListItemResponseDto, description: '更新后的报价草稿（含原价、最新变更状态）' }
    })
    public async httpBaseSrmSimbankUpdateQuoteDraft(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() body: SimbankQuoteDto.UpdateSimbankQuoteDraftDto
    ): Promise<SimbankQuoteDto.SimbankQuoteDraftListItemResponseDto> {
        return this.simbankQuoteService.httpBaseSrmSimbankUpdateQuoteDraft(principal, body)
    }

    @ApiServiceDecorator(Post('draft/status/update'), {
        operation: { summary: '批量变更simbank 报价草稿状态（删除/恢复）' },
        request: { source: 'body', type: SimbankQuoteDto.UpdateSimbankQuoteDraftStatusDto },
        response: { type: AffectedResponseDataDto, description: '变更结果' }
    })
    public async httpBaseSrmSimbankUpdateQuoteDraftStatus(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() body: SimbankQuoteDto.UpdateSimbankQuoteDraftStatusDto
    ): Promise<AffectedResponseDataDto> {
        return this.simbankQuoteService.httpBaseSrmSimbankUpdateQuoteDraftStatus(principal, body)
    }

    @ApiServiceDecorator(Post('draft/delete'), {
        operation: { summary: '批量移除simbank 报价草稿（物理删除）' },
        request: { source: 'body', type: SimbankQuoteDto.DeleteSimbankQuoteDraftDto },
        response: { type: AffectedResponseDataDto, description: '删除结果' }
    })
    public async httpBaseSrmSimbankDeleteQuoteDraft(
        @Body() body: SimbankQuoteDto.DeleteSimbankQuoteDraftDto
    ): Promise<AffectedResponseDataDto> {
        return this.simbankQuoteService.httpBaseSrmSimbankDeleteQuoteDraft(body)
    }

    @ApiServiceDecorator(Post('publish'), {
        operation: { summary: '发布simbank 报价草稿批次' },
        request: { source: 'body', type: SimbankQuoteDto.SimbankQuoteDraftBatchDto },
        response: { type: SimbankQuoteDto.PublishSimbankQuoteResponseDto, description: '报价发布结果' }
    })
    public async httpBaseSrmSimbankPublishQuote(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() body: SimbankQuoteDto.SimbankQuoteDraftBatchDto
    ): Promise<SimbankQuoteDto.PublishSimbankQuoteResponseDto> {
        return this.simbankQuoteService.httpBaseSrmSimbankPublishQuote(principal, body)
    }

    @ApiServiceDecorator(Post('column'), {
        operation: { summary: '分页查询正式simbank 报价' },
        request: { source: 'body', type: SimbankQuoteDto.ListSimbankQuoteDto },
        response: { type: SimbankQuoteDto.SimbankQuotePageResponseDto, description: '正式报价分页数据' }
    })
    public async httpBaseSrmSimbankColumnQuote(@Body() body: SimbankQuoteDto.ListSimbankQuoteDto) {
        return this.simbankQuoteService.httpBaseSrmSimbankColumnQuote(body)
    }
}
