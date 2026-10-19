/** 供应商注册来源默认值：Skyline 枚举 CHUNK_SRM_USER_SOURCE 的枚举项主键，对应客户注册来源默认值 1024186 复制后的枚举项。 */
export const SRM_USER_SOURCE_MANUAL = 1024258

/** 供应商别名规则：RSK + 创建人工号 + 4位随机码，例如 RSK1233A7K9。 */
export const SRM_USER_ALIAS_PREFIX = 'RSK'
/** 供应商别名随机码长度。 */
export const SRM_USER_ALIAS_RANDOM_LENGTH = 4
/** 供应商别名随机码字符集：排除 0、E、I、J、L、O、V、Z，生成结果只能使用这里列出的字符。 */
export const SRM_USER_ALIAS_RANDOM_CHARACTERS = '123456789ABCDFGHKMNPQRSTUWXY'
/** 供应商别名碰撞时的最大重试次数。 */
export const SRM_USER_ALIAS_MAX_ATTEMPTS = 10
