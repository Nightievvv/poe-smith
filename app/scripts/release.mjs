// Ручной релиз PoESmith: `npm run release`.
// Собирает установщик, пушит код и публикует GitHub Release с файлами, по которым приложение находит обновление
// (установщик, .blockmap и latest.yml). Ничего не публикуется автоматически — только при запуске этого скрипта.
// Перед запуском: поднимите "version" в package.json, закоммитьте изменения и закройте собранное приложение
// (оно держит файлы в dist/win-unpacked).
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const version = pkg.version
const tag = `v${version}`
const repo = `${pkg.build.publish[0].owner}/${pkg.build.publish[0].repo}`

if (out('git status --porcelain')) {
  console.error('Есть незакоммиченные изменения — закоммитьте их перед релизом.')
  process.exit(1)
}
try {
  out(`gh release view ${tag} --repo ${repo}`)
  console.error(`Релиз ${tag} уже есть. Поднимите "version" в package.json.`)
  process.exit(1)
} catch {
  /* релиза нет — можно выпускать */
}

run('npx electron-vite build')
run('npx electron-builder --win --publish never')

const files = [`PoESmith-Setup-${version}.exe`, `PoESmith-Setup-${version}.exe.blockmap`, 'latest.yml'].map((f) => join('dist', f))
for (const f of files) if (!existsSync(f)) throw new Error(`Нет файла ${f}`)

const branch = out('git branch --show-current')
run(`git push origin ${branch}`)
run(`gh release create ${tag} ${files.map((f) => `"${f}"`).join(' ')} --repo ${repo} --target ${branch} --title "PoESmith ${version}" --generate-notes`)
console.log(`\nГотово: https://github.com/${repo}/releases/tag/${tag}`)
