import { mdiAndroid, mdiPackageVariantClosed } from '@mdi/js';

import { definePlugins, firstMatch } from '../plugin';
import * as thumb from './thumbnail';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

definePlugins([
  {
    preview: 'apk',
    kind: '安装包',
    exts: ['apk'],
    // 只读中央目录、清单与图标几个片段，不整体载入，因此不设上限
    limit: null,
    icon: mdiAndroid,
    color: 'green-darken-1',
    view: () => import('./View.vue'),
    thumb,
    sniff: firstMatch([{ bytes: ascii('ANDROID!'), label: 'Android boot 镜像' }]),
  },
  // 拆分包只登记类型名与图标，没有预览
  { kind: '安装包', exts: ['apks', 'xapk'], icon: mdiPackageVariantClosed },
]);
