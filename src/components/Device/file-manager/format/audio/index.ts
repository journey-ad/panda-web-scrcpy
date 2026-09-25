import { mdiMusicNote } from '@mdi/js';

import { definePlugin, firstMatch } from '../plugin';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

definePlugin({
  preview: 'audio',
  kind: '音频',
  exts: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'amr'],
  media: true,
  icon: mdiMusicNote,
  color: 'pink-lighten-1',
  view: () => import('./View.vue'),
  sniff: firstMatch([
    { bytes: ascii('WAVE'), offset: 8, label: 'WAV 音频' },
    { bytes: ascii('OggS'), label: 'Ogg 音频' },
    { bytes: ascii('fLaC'), label: 'FLAC 音频' },
    { bytes: ascii('ID3'), label: 'MP3 音频' },
    { bytes: [0xff, 0xfb], label: 'MP3 音频' },
  ]),
});
