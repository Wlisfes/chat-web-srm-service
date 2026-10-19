/** 设备创建命名锁；设备别名按创建人工号自增，串行生成避免序号冲突。 */
export const SRM_SIMBANK_CREATE_LOCK = 'srm:simbank:create'

/** 设备别名规则：SSK + 创建人工号 + SMS + 4位分段序号，例如 SSK1233SMSA001、SSK1233SMSAA01；参考短信应用别名规则。 */
export const SRM_SIMBANK_ALIAS_PREFIX = 'SSK'
/** 设备别名业务类型段。 */
export const SRM_SIMBANK_ALIAS_TYPE = 'SMS'
/** 单字母段数字最大值：A001-Z999。 */
export const SRM_SIMBANK_ALIAS_SINGLE_MAX = 999
/** 双字母段数字最大值：AA01-ZZ99。 */
export const SRM_SIMBANK_ALIAS_DOUBLE_MAX = 99
/** 单字母段容量：26 × 999。 */
export const SRM_SIMBANK_ALIAS_SINGLE_CAPACITY = 26 * SRM_SIMBANK_ALIAS_SINGLE_MAX
/** 同一工号的设备别名总容量：26 × 999 + 26 × 26 × 99。 */
export const SRM_SIMBANK_ALIAS_CAPACITY = SRM_SIMBANK_ALIAS_SINGLE_CAPACITY + 26 * 26 * SRM_SIMBANK_ALIAS_DOUBLE_MAX
