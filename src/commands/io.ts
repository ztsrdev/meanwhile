import { createInterface } from 'node:readline/promises'

export interface CommandIO {
  stdout(message: string): void
  stderr(message: string): void
  confirm(question: string, defaultYes: boolean): Promise<boolean>
}

export const consoleIO: CommandIO = {
  stdout(message) {
    console.log(message)
  },
  stderr(message) {
    console.error(message)
  },
  async confirm(question, defaultYes) {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    try {
      const answer = (await readline.question(question)).trim().toLowerCase()
      if (!answer) {
        return defaultYes
      }
      return answer === 'y' || answer === 'yes'
    } finally {
      readline.close()
    }
  },
}
