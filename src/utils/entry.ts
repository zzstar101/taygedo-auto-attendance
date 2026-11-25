import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 判断当前模块是否是进程入口。
 *
 * 不能直接写 `import.meta.url === `file://${process.argv[1]}``：Windows 下
 * `process.argv[1]` 是 `D:\work\src\action.ts` 这种原生路径，而 `import.meta.url`
 * 是 `file:///D:/work/src/action.ts`，两者永远不相等，入口逻辑会被静默跳过
 * （表现为进程退出码 0、没有任何输出）。这里统一转成 file URL 再比较。
 */
export function isEntryModule(moduleUrl: string): boolean {
  if (typeof process === 'undefined' || !Array.isArray(process.argv)) {
    return false
  }
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    const entryUrl = pathToFileURL(resolve(entry)).href
    // Windows 盘符大小写可能不一致（D: / d:），比较前统一小写。
    return process.platform === 'win32'
      ? moduleUrl.toLowerCase() === entryUrl.toLowerCase()
      : moduleUrl === entryUrl
  }
  catch {
    return false
  }
}
