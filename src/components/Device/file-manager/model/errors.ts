/** 设备操作失败的原因，UI 按它给不同的引导 */
export type ErrorCode = 'disconnected' | 'unsupported' | 'not-found' | 'denied' | 'unknown';

export class DeviceError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'DeviceError';
    this.code = code;
  }
}

/** adb 抛出的错误不带分类，按消息特征归到最近的码上，顺序即优先级 */
const PATTERNS: [ErrorCode, RegExp][] = [
  ['disconnected', /not connected|disconnected|broken pipe|socket|closed/i],
  ['denied', /permission denied|eacces|operation not permitted/i],
  ['not-found', /no such file|not found|does not exist/i],
  ['unsupported', /unsupported|not supported|unknown command|invalid option/i],
];

const matchCode = (error: unknown): ErrorCode => {
  const text = error instanceof Error ? error.message : String(error);
  return PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'unknown';
};

/** 已经带分类的错误用自己的码，其余按消息特征归类 */
export const codeOf = (error: unknown): ErrorCode =>
  error instanceof DeviceError ? error.code : matchCode(error);

/** 失败提示后面追加的一句引导，unknown 时没有可说的 */
const HINTS: Record<ErrorCode, string> = {
  disconnected: '设备已断开，请重新连接',
  unsupported: '这台设备不支持该操作',
  'not-found': '文件或目录已不存在',
  denied: '没有访问权限，换个目录试试',
  unknown: '',
};

/** 拼成「动作失败：原因，引导」；没有可用引导时只报失败原因 */
export const failText = (verb: string, error: unknown) => {
  const hint = HINTS[codeOf(error)];
  const reason = error instanceof Error ? error.message : String(error);
  return hint ? `${verb}失败：${reason}，${hint}` : `${verb}失败：${reason}`;
};
