#!/usr/bin/env node
/**
 * free-port — guarantee the given TCP port(s) are free before `wrangler dev`
 * binds them, so `pnpm dev` is idempotent.
 *
 * Why this is needed: `wrangler dev` runs a `workerd` child that opens its
 * listen socket with SO_REUSEADDR. On Windows a second `wrangler dev` on the
 * same port therefore does NOT fail with EADDRINUSE — it silently double-binds.
 * Worse, killing only the `workerd` child leaves its parent `wrangler` node
 * supervisor alive, which immediately respawns a new `workerd` on the port; the
 * new run then overlaps it, and one of the two `workerd` instances ends up with
 * a wedged accept loop (connections sit in CLOSE_WAIT) → the caller / Next proxy
 * sees "socket hang up / ECONNRESET" on every /api route.
 *
 * So this kills, for THIS repo only, in order:
 *   1. stale `wrangler` node supervisors (so nothing respawns workerd), then
 *   2. every `workerd` process,
 * verifies the port is actually released, and retries briefly.
 *
 * It never touches the current `pnpm dev` run: at `predev` time this run's own
 * `wrangler dev` has not started yet, and the `pnpm --parallel` orchestrator is
 * explicitly excluded.
 *
 * Dependency-free.
 */
import { execFileSync } from 'node:child_process'

const ports = process.argv
  .slice(2)
  .map((p) => Number(p))
  .filter((p) => Number.isInteger(p) && p > 0)
if (ports.length === 0) {
  console.error('free-port: usage: node free-port.mjs <port> [port...]')
  process.exit(1)
}

const isWindows = process.platform === 'win32'
const selfPid = process.pid
// The repo root — used to scope every kill to this checkout only.
const repoRoot = process.cwd().replace(/[\\/]apps[\\/]api[\\/]?$/i, '')
const repoName = repoRoot.split(/[\\/]/).filter(Boolean).pop() ?? 'LikeHoney'

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

function sleep(ms) {
  const end = Date.now() + ms
  try {
    execFileSync(
      isWindows ? 'cmd' : 'sh',
      isWindows
        ? ['/c', `ping -n ${Math.max(2, Math.ceil(ms / 1000) + 1)} 127.0.0.1 >NUL`]
        : ['-c', `sleep ${ms / 1000}`],
      { stdio: 'ignore' },
    )
  } catch {
    /* ignore */
  }
  while (Date.now() < end) {
    /* fallback busy-wait if the sleep helper is unavailable */
  }
}

/** PIDs currently LISTENING on any of `ports` (a double-bind shows >1 row). */
function listeningPids() {
  const pids = new Set()
  if (isWindows) {
    for (const line of run('netstat', ['-a', '-n', '-o', '-p', 'tcp']).split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
      if (m && ports.includes(Number(m[1]))) pids.add(Number(m[2]))
    }
  } else {
    for (const port of ports) {
      const lsof = run('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t'])
      if (lsof)
        for (const p of lsof.split(/\s+/))
          if (p) pids.add(Number(p))
          else
            for (const m of run('ss', ['-ltnpH', 'sport = :' + port]).matchAll(/pid=(\d+)/g))
              pids.add(Number(m[1]))
    }
  }
  pids.delete(selfPid)
  pids.delete(0)
  return [...pids].filter(Number.isInteger)
}

/** Every repo-scoped `wrangler` node supervisor + `workerd` process.
 *  The `--parallel` pnpm orchestrator (the live `pnpm dev`) is excluded. */
function staleDevPids() {
  if (!isWindows) return []
  const ps =
    'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ' +
    "Where-Object { $_.CommandLine -like '*" +
    repoName +
    "*' -and $_.CommandLine -notlike '*--parallel*' } | " +
    "Where-Object { $_.Name -eq 'workerd.exe' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'wrangler(\\.js|-dist)') } | " +
    'ForEach-Object { $_.ProcessId }'
  return run('powershell', ['-NoProfile', '-Command', ps])
    .split(/\r?\n/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== selfPid)
}

function kill(pids) {
  for (const pid of pids) {
    if (pid === selfPid) continue
    if (isWindows) run('taskkill', ['/F', '/T', '/PID', String(pid)])
    else {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }
}

const portLabel = ':' + ports.join(', :')
let targets = [...new Set([...staleDevPids(), ...listeningPids()])]

if (targets.length === 0) {
  console.log(`free-port: ${portLabel} already free`)
  process.exit(0)
}

console.log(
  `free-port: releasing ${portLabel} — killing supervisor/workerd pid(s) ${targets.join(', ')}`,
)
// Supervisors first (so nothing respawns), then anything still on the port.
kill(staleDevPids())
sleep(400)
kill(listeningPids())

for (let i = 0; i < 12; i++) {
  const still = listeningPids()
  if (still.length === 0) {
    console.log('free-port: done')
    process.exit(0)
  }
  kill([...staleDevPids(), ...still])
  sleep(400)
}

console.warn(`free-port: warning — ${portLabel} still appears held; continuing anyway`)
process.exit(0)
