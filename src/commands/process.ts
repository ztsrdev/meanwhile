import {
  displayCommand,
  execute,
  type ExecResult,
} from '../engine/exec.js'

export type ProcessResult = ExecResult

export type ProcessRunner = (
  command: string,
  args: readonly string[],
) => Promise<ProcessResult>

export { displayCommand }

export const runExternal: ProcessRunner = async (command, args) => {
  return execute(command, args, { timeoutMs: 10_000 })
}
