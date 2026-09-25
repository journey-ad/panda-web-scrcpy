/** 设备请求的优先级：浏览与命令优先，缩略图这类批量读取排在最后 */
export type IoPriority = 'interactive' | 'background';

const ORDER: Record<IoPriority, number> = { interactive: 0, background: 1 };

/** 同时在途的设备请求数，adb 是单通道，同时发太多会互相拖慢 */
const CONCURRENCY = 2;

interface Job {
  priority: number;
  start: () => void;
}

const waiting: Job[] = [];
let active = 0;

/** 按优先级插入，同级保持先来后到 */
const enqueue = (job: Job) => {
  const index = waiting.findIndex((item) => item.priority > job.priority);
  if (index < 0) {
    waiting.push(job);
    return;
  }
  waiting.splice(index, 0, job);
};

const pump = () => {
  while (active < CONCURRENCY && waiting.length) {
    const job = waiting.shift()!;
    active += 1;
    job.start();
  }
};

/** 排队执行设备请求，已在途的任务不会被抢占 */
export const runIo = <T>(priority: IoPriority, task: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    enqueue({
      priority: ORDER[priority],
      start: () => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            pump();
          });
      },
    });
    pump();
  });
