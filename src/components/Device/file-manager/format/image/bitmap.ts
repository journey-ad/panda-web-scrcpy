/** 首帧渲染的像素上限，约束超大动图的渲染规模 */
const MAX_FRAME_PIXELS = 40 * 1000 * 1000;

/** 网格缩略图的最长边：格子放大后按容器宽度计算，2 列时也能占满且不出现空白边 */
export const THUMB_MAX_EDGE = 480;

/** 可能含多帧的图片格式，缩略图只取首帧 */
const MULTIFRAME_TYPES = new Set(['image/gif', 'image/webp', 'image/avif', 'image/png']);

/** ANIM 块里背景色之后就是循环次数，小端 2 字节，0 表示无限循环 */
const ANIM_LOOP_OFFSET = 4;

const readUint32 = (bytes: Uint8Array, at: number) =>
  bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);

/**
 * 在文件头里查找 ANIM 块，返回循环次数的下标
 * 静态 WebP、非 WebP 的输入与原本即无限循环的情况都返回 -1；ANIM 一定排在图像数据块之前
 */
const webpLoopOffset = (head: Uint8Array) => {
  if (head.length < 24) return -1;
  const tag = (at: number) =>
    String.fromCharCode(head[at], head[at + 1], head[at + 2], head[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return -1;
  let at = 12;
  while (at + 8 <= head.length) {
    const size = readUint32(head, at + 4);
    if (tag(at) === 'ANIM') {
      const loop = at + 8 + ANIM_LOOP_OFFSET;
      if (loop + 1 >= head.length) return -1;
      return head[loop] === 0 && head[loop + 1] === 0 ? -1 : loop;
    }
    // 扫描到图像数据块就说明没有 ANIM，头部窗口之外停止查找
    if (size < 0 || at + 8 + size > head.length) return -1;
    at += 8 + size + (size % 2);
  }
  return -1;
};

/**
 * 动图 WebP 按无限循环播放：ANIM 中记录的循环次数改为 0
 * 静态 WebP 与其他格式原样返回，不复制数据
 */
export const loopAnimatedWebp = async (blob: Blob): Promise<Blob> => {
  const head = new Uint8Array(await blob.slice(0, 96).arrayBuffer());
  const at = webpLoopOffset(head);
  if (at < 0) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  bytes[at] = 0;
  bytes[at + 1] = 0;
  return new Blob([bytes], { type: blob.type });
};

/**
 * 动图只渲染第一帧，列表里不会自己播放，所有缩略图看到的是同一帧
 * 静态图返回 null，直接使用原文件；预览窗口需要动画，不使用该函数
 */
export const firstFrameBlob = async (blob: Blob): Promise<Blob | null> => {
  if (typeof ImageDecoder === 'undefined' || !MULTIFRAME_TYPES.has(blob.type)) return null;
  let decoder: ImageDecoder | undefined;
  try {
    // complete: true 表示字节已全部读取；不声明的话解码器会一直等待后续数据，帧信息无法获取
    // 该字段较新，TS 内置的 ImageDecoderInit 尚未收录，运行时可用
    decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type, complete: true } as ImageDecoderInit);
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack ?? decoder.tracks[0];
    if (!track || track.frameCount <= 1) return null;
    const { image } = await decoder.decode({ frameIndex: 0 });
    const width = image.displayWidth;
    const height = image.displayHeight;
    if (!width || !height || width * height > MAX_FRAME_PIXELS) {
      image.close();
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      image.close();
      return null;
    }
    context.drawImage(image, 0, 0);
    image.close();
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/png');
    });
  } catch {
    return null;
  } finally {
    decoder?.close();
  }
};

/**
 * 缩到最长边不超过 maxEdge：尺寸本就不超过上限的图原样返回，大图重采样成小图
 */
export const scaleImageBlob = async (blob: Blob, maxEdge: number): Promise<Blob | null> => {
  try {
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (!longest) {
      bitmap.close();
      return null;
    }
    if (longest <= maxEdge) {
      bitmap.close();
      return blob;
    }
    const scale = maxEdge / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return null;
    }
    // 带透明通道的图转 JPEG 会变成黑底，先填充白色背景
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.8);
    });
  } catch {
    return null;
  }
};

/** 抽帧等待上限 */
const POSTER_TIMEOUT = 12000;

/**
 * 复用播放器从视频里抽一帧做封面，src 可以指向 Service Worker 代理，
 * 只按需取少量字节
 */
export const videoPosterBlob = (src: string, maxEdge: number): Promise<Blob | null> =>
  new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    let capturing = false;

    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(blob);
    };

    const capture = () => {
      if (settled || capturing) return;
      capturing = true;
      const { videoWidth, videoHeight } = video;
      if (!videoWidth || !videoHeight) {
        finish(null);
        return;
      }
      const scale = Math.min(1, maxEdge / Math.max(videoWidth, videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(videoWidth * scale));
      canvas.height = Math.max(1, Math.round(videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        finish(null);
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.72);
    };

    const timer = setTimeout(() => finish(null), POSTER_TIMEOUT);

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.addEventListener(
      'loadedmetadata',
      () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        // 开头几帧多为纯黑画面，稍向后偏移再抽帧
        video.currentTime = duration > 0 ? Math.min(duration * 0.1, 3) : 0;
      },
      { once: true }
    );
    video.addEventListener('seeked', capture, { once: true });
    video.addEventListener('error', () => finish(null), { once: true });
    video.src = src;
  });

