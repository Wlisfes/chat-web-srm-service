import { Body, Get, Post, Query } from '@nestjs/common'
import { CurrentPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import type { AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { ApiServiceDecorator, ApifoxController, SuccessResponseDataDto } from '@wlisfes/chat-web-base-schema/decorator'
import { ChannelService } from '@/modules/channel/channel.service'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as ChannelDto from '@/modules/channel/dto/channel.dto'

@ApifoxController('供应商关系管理-短信通道', 'channel', { bearerAuth: true })
export class ChannelController {
    constructor(private readonly channelService: ChannelService) {}

    @ApiServiceDecorator(Get('enums'), {
        operation: { summary: '获取通道静态枚举' },
        response: { type: ChannelDto.ChannelEnumsResponseDto, description: '通道静态枚举' }
    })
    public async httpBaseSrmChannelEnums() {
        return this.channelService.httpBaseSrmChannelEnums()
    }

    @ApiServiceDecorator(Post('create'), {
        operation: { summary: '新增通道' },
        request: { source: 'body', type: ChannelDto.CreateChannelDto },
        response: { type: Schema.TbSrmChannelDto, description: '新增后的通道' }
    })
    public async httpBaseSrmCreateChannel(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: ChannelDto.CreateChannelDto) {
        return this.channelService.httpBaseSrmCreateChannel(principal, input)
    }

    @ApiServiceDecorator(Post('update'), {
        operation: { summary: '编辑通道' },
        request: { source: 'body', type: ChannelDto.UpdateChannelDto },
        response: { type: Schema.TbSrmChannelDto, description: '编辑后的通道' }
    })
    public async httpBaseSrmUpdateChannel(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: ChannelDto.UpdateChannelDto) {
        return this.channelService.httpBaseSrmUpdateChannel(principal, input)
    }

    @ApiServiceDecorator(Post('status/update'), {
        operation: { summary: '启用、停用通道' },
        request: { source: 'body', type: ChannelDto.UpdateChannelStatusDto },
        response: { type: Schema.TbSrmChannelDto, description: '更新后的通道' }
    })
    public async httpBaseSrmChannelStatusUpdate(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: ChannelDto.UpdateChannelStatusDto
    ) {
        return this.channelService.httpBaseSrmChannelStatusUpdate(principal, input)
    }

    @ApiServiceDecorator(Post('delete'), {
        operation: { summary: '删除通道' },
        request: { source: 'body', type: ChannelDto.ChannelKeyDto },
        response: { type: SuccessResponseDataDto, description: '删除结果' }
    })
    public async httpBaseSrmDeleteChannel(@Body() input: ChannelDto.ChannelKeyDto) {
        return this.channelService.httpBaseSrmDeleteChannel(input)
    }

    @ApiServiceDecorator(Get('resolve'), {
        operation: { summary: '获取通道详情' },
        request: { source: 'query', type: ChannelDto.ChannelKeyDto },
        response: { type: Schema.TbSrmChannelDto, description: '通道详情' }
    })
    public async httpBaseSrmChannelResolver(@Query() input: ChannelDto.ChannelKeyDto) {
        return this.channelService.httpBaseSrmChannelResolver(input)
    }

    @ApiServiceDecorator(Post('column'), {
        operation: { summary: '分页查询通道' },
        request: { source: 'body', type: ChannelDto.ListChannelDto },
        response: { type: ChannelDto.ChannelPageResponseDto, description: '通道分页数据' }
    })
    public async httpBaseSrmColumnChannel(@Body() input: ChannelDto.ListChannelDto) {
        return this.channelService.httpBaseSrmColumnChannel(input)
    }

    @ApiServiceDecorator(Get('select'), {
        operation: { summary: '获取通道下拉选项' },
        response: { type: ChannelDto.ChannelSelectResponseDto, isArray: true, description: '通道下拉选项' }
    })
    public async httpBaseSrmSelectChannel() {
        return this.channelService.httpBaseSrmSelectChannel()
    }

    @ApiServiceDecorator(Post('port/bind'), {
        operation: { summary: '通道批量绑定端口' },
        request: { source: 'body', type: ChannelDto.BindChannelPortDto },
        response: { type: SuccessResponseDataDto, description: '绑定数量' }
    })
    public async httpBaseSrmBindChannelPort(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: ChannelDto.BindChannelPortDto) {
        return this.channelService.httpBaseSrmBindChannelPort(principal, input)
    }

    @ApiServiceDecorator(Post('port/update'), {
        operation: { summary: '编辑通道端口权重和状态' },
        request: { source: 'body', type: ChannelDto.UpdateChannelPortDto },
        response: { type: Schema.TbSrmChannelPortDto, description: '更新后的端口绑定' }
    })
    public async httpBaseSrmUpdateChannelPort(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: ChannelDto.UpdateChannelPortDto
    ) {
        return this.channelService.httpBaseSrmUpdateChannelPort(principal, input)
    }

    @ApiServiceDecorator(Post('port/column'), {
        operation: { summary: '分页查询通道端口' },
        request: { source: 'body', type: ChannelDto.ListChannelPortDto },
        response: { type: ChannelDto.ChannelPortPageResponseDto, description: '通道端口分页数据' }
    })
    public async httpBaseSrmColumnChannelPort(@Body() input: ChannelDto.ListChannelPortDto) {
        return this.channelService.httpBaseSrmColumnChannelPort(input)
    }

    @ApiServiceDecorator(Post('port/select'), {
        operation: { summary: '按方向和归属人查询可绑定端口' },
        request: { source: 'body', type: ChannelDto.ListOwnerCountryPortDto },
        response: { type: ChannelDto.OwnerCountryPortItemDto, isArray: true, description: '匹配方向和归属人的全部可绑定端口，不分页' }
    })
    public async httpBaseSrmSelectChannelPort(@Body() input: ChannelDto.ListOwnerCountryPortDto) {
        return this.channelService.httpBaseSrmSelectChannelPort(input)
    }
}
