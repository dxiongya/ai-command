#!/usr/bin/env node

import { cac } from 'cac'
import { version } from '../package.json'

export async function main() {
  const cli = cac('ais')

  cli
    .command('ask <message>', 'Ask ai about command question')
    .option('--model <model_type>', 'Model: gpt3.5 or gpt4.0')
    .option('--no-copy', 'Disable auto copy')
    .action(async (inputs: string, flags) => {      
      const { ask } = await import('.')
      ask(inputs, flags);
    })

  cli
    .command('chat', 'Chat with ai')
    .option('--model <model_type>', 'Model: gpt3.5 or gpt4.0')
    .action(async (flags) => {
      const { chat } = await import('.')
      chat(flags);
    })

  cli
    .command('cursor', 'Start Cursor chat dashboard')
    .option('--port <port>', 'Port for dashboard (default: 7337)')
    .option('--host <host>', 'Host for dashboard (default: 127.0.0.1)')
    .option('--open', 'Open dashboard in browser')
    .action(async (flags) => {
      const { startCursorDashboard } = await import('./cursor/dashboard')
      startCursorDashboard(flags);
    })

  cli
    .command('cursor-track', 'Auto track Cursor chat status')
    .option('--log <path>', 'Cursor log file path')
    .option('--log-dir <path>', 'Cursor logs directory')
    .option('--cursor-root <path>', 'Cursor config root directory')
    .option('--editor <name>', 'Default editor name')
    .option('--title <title>', 'Default title')
    .option('--link <link>', 'Default link')
    .option('--from-start', 'Parse existing log content before watching')
    .option('--once', 'Process log content once and exit')
    .option('--note-from-log', 'Use log line snippet as note')
    .option('--print', 'Print matched events')
    .action(async (flags) => {
      const { startCursorTracker } = await import('./cursor/tracker')
      startCursorTracker(flags);
    })

  cli
    .command("set <key> <value>", "Set config")
    .action(async (key: string, value: string) => {
      const { set } = await import('./config')
      set([key, value])
    })

  cli
    .command("ls", "List config")
    .action(async () => {
      const { ls } = await import('./config')
      ls();
    })

  cli.help()

  cli.version(version)

  cli.parse(process.argv, { run: false })
  await cli.runMatchedCommand()
}

main();