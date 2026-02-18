#!/usr/bin/env node

const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

let wrapperVersion
try {
  // eslint-disable-next-line import/no-dynamic-require
  wrapperVersion = require("../package.json")?.version
} catch {
  wrapperVersion = undefined
}

function isMusl() {
  if (process.platform !== "linux") return false

  try {
    if (fs.existsSync("/etc/alpine-release")) return true
  } catch {
    // ignore
  }

  try {
    const result = childProcess.spawnSync("ldd", ["--version"], { encoding: "utf8" })
    const text = ((result.stdout || "") + (result.stderr || "")).toLowerCase()
    return text.includes("musl")
  } catch {
    return false
  }
}

function run(target, packageRoot) {
  const env = { ...process.env }
  if (packageRoot) {
    env.DEXTO_PACKAGE_ROOT = packageRoot
  }
  if (!env.DEXTO_CLI_VERSION && typeof wrapperVersion === "string" && wrapperVersion.length > 0) {
    env.DEXTO_CLI_VERSION = wrapperVersion
  }

  const result = childProcess.spawnSync(target, process.argv.slice(2), {
    stdio: "inherit",
    env,
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  const code = typeof result.status === "number" ? result.status : 0
  process.exit(code)
}

function candidatePackageNames() {
  const platform = os.platform()
  const arch = os.arch()
  const musl = isMusl()

  if (platform === "darwin" && arch === "arm64") return ["dexto-darwin-arm64"]
  if (platform === "darwin" && arch === "x64") return ["dexto-darwin-x64"]

  if (platform === "linux" && arch === "arm64") {
    return musl ? ["dexto-linux-arm64-musl", "dexto-linux-arm64"] : ["dexto-linux-arm64", "dexto-linux-arm64-musl"]
  }
  if (platform === "linux" && arch === "x64") {
    return musl ? ["dexto-linux-x64-musl", "dexto-linux-x64"] : ["dexto-linux-x64", "dexto-linux-x64-musl"]
  }

  if (platform === "win32" && arch === "x64") return ["dexto-win32-x64"]

  return []
}

function resolveBinary(packageName) {
  const exeName = process.platform === "win32" ? "dexto.exe" : "dexto"

  let pkgJsonPath
  try {
    // Resolve from this script's directory to support global installs reliably.
    pkgJsonPath = require.resolve(`${packageName}/package.json`, { paths: [__dirname] })
  } catch {
    return
  }

  const packageRoot = path.dirname(pkgJsonPath)
  const binaryPath = path.join(packageRoot, "bin", exeName)
  if (!fs.existsSync(binaryPath)) return

  return { binaryPath, packageRoot }
}

const candidates = candidatePackageNames()
for (const name of candidates) {
  const resolved = resolveBinary(name)
  if (resolved) {
    run(resolved.binaryPath, resolved.packageRoot)
  }
}

if (candidates.length === 0) {
  console.error(`Unsupported platform/arch: ${process.platform}/${process.arch}`)
  process.exit(1)
}

console.error(
  "It looks like your package manager did not install the correct dexto binary for your platform.\n" +
    `Tried: ${candidates.map((n) => `"${n}"`).join(", ")}\n` +
    "If your environment disables optionalDependencies, re-install without that restriction.",
)
process.exit(1)
