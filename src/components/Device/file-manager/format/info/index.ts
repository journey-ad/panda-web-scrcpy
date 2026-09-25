import { definePlugin, firstMatch } from '../plugin';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/**
 * 默认插件：不认领任何扩展名，只提供信息面板
 * 没有内置预览的类型、以及体积超过预览上限的文件都交给它
 */
definePlugin({
  exts: [],
  fallback: true,
  view: () => import('./View.vue'),
  /** 不属于任何文件类型的可执行与字节码，只在信息面板里识别 */
  sniff: firstMatch([
    { bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'ELF 可执行文件' },
    { bytes: ascii('dex\n'), label: 'Dalvik 字节码' },
    { bytes: [0xca, 0xfe, 0xba, 0xbe], label: 'Java class 字节码' },
    { bytes: ascii('MZ'), label: 'Windows 可执行文件' },
  ]),
});
