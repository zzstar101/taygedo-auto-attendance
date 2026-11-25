import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = resolve(root, 'dist/cloud-function')
const outfile = resolve(outdir, 'index.js')
const zipfile = resolve(root, 'dist/cloud-function.zip')

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/runtimes/cloud-function.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
})

await writeFile(resolve(outdir, 'package.json'), '{"type":"commonjs"}\n', 'utf8')

if (process.argv.includes('--pack')) {
  await rm(zipfile, { force: true })
  pack(outdir, zipfile)
  console.log(`云函数部署包已生成：${zipfile}`)
}
else {
  console.log(`云函数构建产物已生成：${dirname(outfile)}`)
}

/**
 * Windows 默认没有 `zip` 命令，直接 spawn 会报 ENOENT。
 * 依次尝试 `zip`、Windows 10+ 自带的 bsdtar（`%SystemRoot%\System32\tar.exe`）。
 * 注意不能直接用 PATH 上的 `tar`：Git for Windows 自带的是 GNU tar，不支持 zip 格式。
 */
function pack(cwd, target) {
  const attempts = [['zip', ['-qr', target, '.']]]
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    attempts.push([resolve(systemRoot, 'System32', 'tar.exe'), ['-a', '-c', '-f', target, '.']])
  }

  const tried = []
  for (const [command, args] of attempts) {
    tried.push(command)
    const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
    if (result.error && result.error.code === 'ENOENT') {
      continue
    }
    if (result.error) {
      throw result.error
    }
    if (result.status !== 0) {
      throw new Error(`${command} 命令失败，退出码：${result.status ?? 'unknown'}`)
    }
    return
  }

  throw new Error(`未找到可用的打包命令（已尝试：${tried.join('、')}）；请安装 zip，或手动压缩 dist/cloud-function 目录`)
}
