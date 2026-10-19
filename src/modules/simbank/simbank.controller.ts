import { Body, Get, Post, Query } from '@nestjs/common'
import { CurrentPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import type { AuthPrincipal } from '@wlisfes/chat-web-base-schema/auth'
import { ApiServiceDecorator, ApifoxController } from '@wlisfes/chat-web-base-schema/decorator'
import { SimbankService } from '@/modules/simbank/simbank.service'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as SimbankDto from '@/modules/simbank/dto/simbank.dto'

@ApifoxController('供应商关系管理-SIMBANK设备', 'simbank', { bearerAuth: true })
export class SimbankController {
    constructor(private readonly simbankService: SimbankService) {}

    @ApiServiceDecorator(Get('enums'), {
        operation: { summary: '获取设备静态枚举' },
        response: { type: SimbankDto.SimbankEnumsResponseDto, description: '设备静态枚举' }
    })
    public async httpBaseSrmSimbankEnums() {
        return this.simbankService.httpBaseSrmSimbankEnums()
    }

    @ApiServiceDecorator(Post('create'), {
        operation: { summary: '新增设备' },
        request: { source: 'body', type: SimbankDto.CreateSimbankDto },
        response: { type: Schema.TbSrmSimbankDto, description: '新增后的设备信息' }
    })
    public async httpBaseSrmCreateSimbank(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: SimbankDto.CreateSimbankDto) {
        return this.simbankService.httpBaseSrmCreateSimbank(principal, input)
    }

    @ApiServiceDecorator(Post('update'), {
        operation: { summary: '编辑设备' },
        request: { source: 'body', type: SimbankDto.UpdateSimbankDto },
        response: { type: Schema.TbSrmSimbankDto, description: '编辑后的设备信息' }
    })
    public async httpBaseSrmUpdateSimbank(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: SimbankDto.UpdateSimbankDto) {
        return this.simbankService.httpBaseSrmUpdateSimbank(principal, input)
    }

    @ApiServiceDecorator(Post('status/update'), {
        operation: { summary: '更新设备状态' },
        request: { source: 'body', type: SimbankDto.UpdateSimbankStatusDto },
        response: { type: Schema.TbSrmSimbankDto, description: '更新后的设备信息' }
    })
    public async httpBaseSrmSimbankStatusUpdate(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: SimbankDto.UpdateSimbankStatusDto
    ) {
        return this.simbankService.httpBaseSrmSimbankStatusUpdate(principal, input)
    }

    @ApiServiceDecorator(Post('column'), {
        operation: { summary: '分页查询设备' },
        request: { source: 'body', type: SimbankDto.ListSimbankDto },
        response: { type: SimbankDto.SimbankPageResponseDto, description: '设备分页数据（含归属供应商、归属人、创建人、更新人信息）' }
    })
    public async httpBaseSrmColumnSimbank(@Body() input: SimbankDto.ListSimbankDto) {
        return this.simbankService.httpBaseSrmColumnSimbank(input)
    }

    @ApiServiceDecorator(Get('resolve'), {
        operation: { summary: '获取设备详情' },
        request: { source: 'query', type: SimbankDto.ResolveSimbankDto },
        response: { type: SimbankDto.SimbankColumnResponseDto, description: '设备详情（含归属供应商、归属人、创建人、更新人信息）' }
    })
    public async httpBaseSrmSimbankResolver(@Query() query: SimbankDto.ResolveSimbankDto) {
        return this.simbankService.httpBaseSrmSimbankResolver(query)
    }

    @ApiServiceDecorator(Get('select'), {
        operation: { summary: '获取设备下拉选项' },
        request: { source: 'query', type: SimbankDto.SelectSimbankDto },
        response: { type: SimbankDto.SimbankSelectResponseDto, isArray: true, description: '设备下拉选项' }
    })
    public async httpBaseSrmSelectSimbank(@Query() query: SimbankDto.SelectSimbankDto) {
        return this.simbankService.httpBaseSrmSelectSimbank(query)
    }
}
