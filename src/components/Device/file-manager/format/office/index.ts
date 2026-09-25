import { mdiFileDocumentOutline, mdiFileExcelBox, mdiFilePdfBox, mdiFilePowerpointBox, mdiFileWordBox } from '@mdi/js';

import { definePlugins, firstMatch } from '../plugin';

definePlugins([
  {
    preview: 'pdf',
    kind: 'PDF',
    exts: ['pdf'],
    icon: mdiFilePdfBox,
    color: 'red-lighten-1',
    view: () => import('./View.vue'),
    sniff: firstMatch([{ bytes: [0x25, 0x50, 0x44, 0x46], label: 'PDF 文档' }]),
  },
  {
    preview: 'docx',
    kind: '文档',
    exts: ['docx'],
    icon: mdiFileWordBox,
    color: 'indigo-lighten-1',
    view: () => import('./View.vue'),
  },
  {
    preview: 'xlsx',
    kind: '表格',
    exts: ['xlsx'],
    icon: mdiFileExcelBox,
    color: 'teal-darken-1',
    view: () => import('./View.vue'),
  },
  {
    preview: 'pptx',
    kind: '演示',
    exts: ['pptx'],
    icon: mdiFilePowerpointBox,
    color: 'deep-orange-lighten-1',
    view: () => import('./View.vue'),
  },
  // 以下三种只有类型名与图标，@vue-office 不支持渲染，也没有其他预览
  { kind: '文档', exts: ['doc', 'rtf', 'odt', 'pages'], icon: mdiFileDocumentOutline },
  { kind: '表格', exts: ['xls', 'ods', 'numbers'], icon: mdiFileDocumentOutline },
  { kind: '演示', exts: ['ppt', 'key'], icon: mdiFileDocumentOutline },
]);
