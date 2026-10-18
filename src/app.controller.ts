import { Get } from '@nestjs/common'
import { Public } from '@wlisfes/chat-web-base-schema/auth'
import { ApiServiceDecorator, ApifoxController } from '@wlisfes/chat-web-base-schema/decorator'
import { PreserveHttpStatus } from '@wlisfes/chat-web-base-schema/filters'
import { AppService } from '@/app.service'
import * as HealthDto from '@/health/dto/health.dto'

@ApifoxController('SRM 服务-运行状态')
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Public()
    @ApiServiceDecorator(Get(), {
        operation: { summary: '查看 SRM 服务信息' },
        response: { type: String, description: 'SRM 服务名称' }
    })
    public async httpBaseSrmResolverService(): Promise<string> {
        return this.appService.httpBaseSrmResolverService()
    }

    @Public()
    @ApiServiceDecorator(Get('health/live'), {
        operation: { summary: 'SRM 服务存活检查' },
        response: { type: HealthDto.ServiceLivenessResponseDto, description: '进程正常时返回 UP' }
    })
    public async httpBaseSrmLiveHealth(): Promise<HealthDto.ServiceLivenessResponseDto> {
        return this.appService.httpBaseSrmLiveHealth()
    }

    @Public()
    @ApiServiceDecorator(Get(['health', 'health/ready']), {
        operation: { summary: 'SRM 服务就绪检查' },
        response: { type: HealthDto.ServiceReadinessResponseDto, description: '数据库、Redis 与鉴权配置状态' }
    })
    @PreserveHttpStatus()
    public async httpBaseSrmReadyHealth(): Promise<HealthDto.ServiceReadinessResponseDto> {
        return this.appService.httpBaseSrmReadyHealth()
    }
}
