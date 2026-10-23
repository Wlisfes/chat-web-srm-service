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

    @ApiServiceDecorator(Get('port/enums'), {
        operation: { summary: '获取端口静态枚举' },
        response: { type: SimbankDto.SimbankPortEnumsResponseDto, description: '端口静态枚举' }
    })
    public async httpBaseSrmSimbankPortEnums() {
        return this.simbankService.httpBaseSrmSimbankPortEnums()
    }

    @ApiServiceDecorator(Post('port/column'), {
        operation: { summary: '分页查询端口' },
        request: { source: 'body', type: SimbankDto.ListSimbankPortDto },
        response: {
            type: SimbankDto.SimbankPortPageResponseDto,
            description: '端口分页数据（含所属设备、归属供应商、归属人、创建人、更新人信息）'
        }
    })
    public async httpBaseSrmColumnSimbankPort(@Body() input: SimbankDto.ListSimbankPortDto) {
        return this.simbankService.httpBaseSrmColumnSimbankPort(input)
    }

    @ApiServiceDecorator(Post('port/status/update'), {
        operation: { summary: '更新端口状态' },
        request: { source: 'body', type: SimbankDto.UpdateSimbankPortStatusDto },
        response: { type: Schema.TbSrmSimbankPortDto, description: '更新后的端口信息' }
    })
    public async httpBaseSrmSimbankPortStatusUpdate(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: SimbankDto.UpdateSimbankPortStatusDto
    ) {
        return this.simbankService.httpBaseSrmSimbankPortStatusUpdate(principal, input)
    }

    @ApiServiceDecorator(Get('port/faker'), {
        operation: { summary: '按激活方向随机生成插卡模拟数据' },
        request: { source: 'query', type: SimbankDto.SimbankPortFakerQueryDto },
        response: { type: SimbankDto.SimbankPortFakerResponseDto, description: '插卡表单初始化数据' }
    })
    public httpBaseSrmSimbankPortFaker(@Query() query: SimbankDto.SimbankPortFakerQueryDto) {
        return this.simbankService.httpBaseSrmSimbankPortFaker(query)
    }

    @ApiServiceDecorator(Post('port/insert'), {
        operation: { summary: '插入 SIM 卡' },
        request: { source: 'body', type: SimbankDto.InsertSimbankPortDto },
        response: { type: Schema.TbSrmSimbankPortDto, description: '插卡后的端口信息' }
    })
    public async httpBaseSrmSimbankPortInsert(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: SimbankDto.InsertSimbankPortDto
    ) {
        return this.simbankService.httpBaseSrmSimbankPortInsert(principal, input)
    }

    @ApiServiceDecorator(Post('port/activate'), {
        operation: { summary: '激活 SIM 卡' },
        request: { source: 'body', type: SimbankDto.ActivateSimbankPortDto },
        response: { type: Schema.TbSrmSimbankPortDto, description: '激活后的端口信息' }
    })
    public async httpBaseSrmSimbankPortActivate(
        @CurrentPrincipal() principal: AuthPrincipal,
        @Body() input: SimbankDto.ActivateSimbankPortDto
    ) {
        return this.simbankService.httpBaseSrmSimbankPortActivate(principal, input)
    }

    @ApiServiceDecorator(Post('port/remove'), {
        operation: { summary: '拔出 SIM 卡' },
        request: { source: 'body', type: SimbankDto.SimbankPortKeyDto },
        response: { type: Schema.TbSrmSimbankPortDto, description: '拔卡后的端口信息' }
    })
    public async httpBaseSrmSimbankPortRemove(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: SimbankDto.SimbankPortKeyDto) {
        return this.simbankService.httpBaseSrmSimbankPortRemove(principal, input)
    }

    @ApiServiceDecorator(Post('port/release'), {
        operation: { summary: '释放已激活端口' },
        request: { source: 'body', type: SimbankDto.SimbankPortKeyDto },
        response: { type: Schema.TbSrmSimbankPortDto, description: '释放后的端口信息' }
    })
    public async httpBaseSrmSimbankPortRelease(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: SimbankDto.SimbankPortKeyDto) {
        return this.simbankService.httpBaseSrmSimbankPortRelease(principal, input)
    }

    @ApiServiceDecorator(Get('message/enums'), {
        operation: { summary: '获取短信历史静态枚举' },
        response: { type: SimbankDto.SimbankMessageEnumsResponseDto, description: '短信历史静态枚举' }
    })
    public async httpBaseSrmSimbankMessageEnums() {
        return this.simbankService.httpBaseSrmSimbankMessageEnums()
    }

    @ApiServiceDecorator(Post('message/column'), {
        operation: { summary: '分页查询短信历史' },
        request: { source: 'body', type: SimbankDto.ListSimbankMessageDto },
        response: { type: SimbankDto.SimbankMessagePageResponseDto, description: '短信历史分页数据（含归属人信息）' }
    })
    public async httpBaseSrmColumnSimbankMessage(@Body() input: SimbankDto.ListSimbankMessageDto) {
        return this.simbankService.httpBaseSrmColumnSimbankMessage(input)
    }

    @ApiServiceDecorator(Post('port/select'), {
        operation: { summary: '按方向和归属人查询可绑定端口' },
        request: { source: 'body', type: SimbankDto.ListOwnerCountryPortDto },
        response: { type: SimbankDto.OwnerCountryPortItemDto, isArray: true, description: '匹配方向和归属人的全部可绑定端口，不分页' }
    })
    public async httpBaseSrmSelectSimbankPort(@Body() input: SimbankDto.ListOwnerCountryPortDto) {
        return this.simbankService.httpBaseSrmSelectSimbankPort(input)
    }
}
