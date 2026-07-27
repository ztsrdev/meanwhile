export function isDryRun(): boolean {
  return process.env.MEANWHILE_DRYRUN === '1'
}

export function underConductor(): boolean {
  return Object.keys(process.env).some((key) => key.startsWith('CONDUCTOR_'))
}
