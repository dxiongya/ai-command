import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import chokidar from 'chokidar';
import { error, success, warn } from '../utils/log';
import {
  DashboardStatus,
  readState,
  writeState,
  upsertItem,
  getItemById,
  STATE_PATH,
} from './state';

type TrackerFlags = {
  log?: string;
  logDir?: string;
  cursorRoot?: string;
  editor?: string;
  title?: string;
  link?: string;
  fromStart?: boolean;
  once?: boolean;
  noteFromLog?: boolean;
  print?: boolean;
};

type TrackerEvent = {
  status: DashboardStatus;
  id?: string;
  title?: string;
  editor?: string;
  link?: string;
  note?: string;
};

const DEFAULT_TITLE = 'Cursor Chat';
const DEFAULT_EDITOR = 'Cursor';
const MAX_NOTE_LENGTH = 200;

const STATUS_PATTERNS = {
  failed: [
    /cursor.*chat.*(error|failed|exception)/i,
    /chat.*request.*failed/i,
    /ai.*error/i,
  ],
  success: [
    /cursor.*chat.*(complete|success|done|finished)/i,
    /chat.*response.*received/i,
    /ai.*response.*received/i,
  ],
  running: [/cursor.*chat.*start/i, /chat.*request/i, /composer.*start/i, /ai.*request/i],
};

const ID_PATTERNS = [
  /requestId[:=]\s*([A-Za-z0-9-_]+)/i,
  /conversationId[:=]\s*([A-Za-z0-9-_]+)/i,
  /chatId[:=]\s*([A-Za-z0-9-_]+)/i,
  /taskId[:=]\s*([A-Za-z0-9-_]+)/i,
];

const TITLE_PATTERNS = [
  /prompt[:=]\s*"([^"]{1,120})"/i,
  /message[:=]\s*"([^"]{1,120})"/i,
  /title[:=]\s*"([^"]{1,120})"/i,
];

const EDITOR_PATTERNS = [
  /workspace[:=]\s*([A-Za-z0-9_./-]+)/i,
  /folder[:=]\s*([A-Za-z0-9_./-]+)/i,
  /project[:=]\s*([A-Za-z0-9_./-]+)/i,
];

const STATUS_ALIASES: Record<string, DashboardStatus> = {
  start: 'running',
  started: 'running',
  running: 'running',
  in_progress: 'running',
  progress: 'running',
  success: 'success',
  completed: 'success',
  complete: 'success',
  done: 'success',
  failed: 'failed',
  error: 'failed',
  exception: 'failed',
};

const createStableId = (seed: string) => {
  return `cursor_${crypto
    .createHash('sha1')
    .update(seed)
    .digest('hex')
    .slice(0, 12)}`;
};

const extractFirstMatch = (line: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return undefined;
};

const matchAny = (line: string, patterns: RegExp[]) => {
  return patterns.some((pattern) => pattern.test(line));
};

const resolveStatusFromValue = (value: unknown): DashboardStatus | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const key = value.trim().toLowerCase();
  if (key in STATUS_ALIASES) {
    return STATUS_ALIASES[key];
  }
  return null;
};

const parseEventPayload = (payload: any): TrackerEvent | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const status =
    resolveStatusFromValue(payload.status) ||
    resolveStatusFromValue(payload.event) ||
    resolveStatusFromValue(payload.phase) ||
    resolveStatusFromValue(payload.type);
  if (!status) {
    return null;
  }
  return {
    status,
    id:
      payload.id ||
      payload.requestId ||
      payload.conversationId ||
      payload.chatId ||
      payload.taskId,
    title: payload.title || payload.prompt || payload.message,
    editor: payload.editor || payload.workspace || payload.folder || payload.project,
    link: payload.link,
    note: payload.note,
  };
};

const parseEventFromJsonMarker = (line: string): TrackerEvent | null => {
  const marker = 'AIM_CURSOR_EVENT';
  const index = line.indexOf(marker);
  if (index === -1) {
    return null;
  }
  const raw = line.slice(index + marker.length).trim();
  if (!raw) {
    return null;
  }
  const cleaned = raw.replace(/^[:=]/, '').trim();
  try {
    return parseEventPayload(JSON.parse(cleaned));
  } catch (err) {
    return null;
  }
};

const parseEventFromJsonLine = (line: string): TrackerEvent | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  try {
    return parseEventPayload(JSON.parse(trimmed));
  } catch (err) {
    return null;
  }
};

const parseEventFromPatterns = (line: string): TrackerEvent | null => {
  if (matchAny(line, STATUS_PATTERNS.failed)) {
    return {
      status: 'failed',
      id: extractFirstMatch(line, ID_PATTERNS),
      title: extractFirstMatch(line, TITLE_PATTERNS),
      editor: extractFirstMatch(line, EDITOR_PATTERNS),
    };
  }
  if (matchAny(line, STATUS_PATTERNS.success)) {
    return {
      status: 'success',
      id: extractFirstMatch(line, ID_PATTERNS),
      title: extractFirstMatch(line, TITLE_PATTERNS),
      editor: extractFirstMatch(line, EDITOR_PATTERNS),
    };
  }
  if (matchAny(line, STATUS_PATTERNS.running)) {
    return {
      status: 'running',
      id: extractFirstMatch(line, ID_PATTERNS),
      title: extractFirstMatch(line, TITLE_PATTERNS),
      editor: extractFirstMatch(line, EDITOR_PATTERNS),
    };
  }
  return null;
};

const parseEvent = (line: string): TrackerEvent | null => {
  return (
    parseEventFromJsonMarker(line) ||
    parseEventFromJsonLine(line) ||
    parseEventFromPatterns(line)
  );
};

const expandHome = (input: string) => {
  if (input.startsWith('~')) {
    return path.join(os.homedir(), input.slice(1));
  }
  return input;
};

const detectDefaultLogDir = () => {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'logs');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'logs');
  }
  return path.join(home, '.config', 'Cursor', 'logs');
};

const collectLogFiles = (dir: string) => {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.log')) {
      files.push(fullPath);
      continue;
    }
    if (entry.isDirectory()) {
      const nested = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const subEntry of nested) {
        const subPath = path.join(fullPath, subEntry.name);
        if (subEntry.isFile() && subEntry.name.endsWith('.log')) {
          files.push(subPath);
        }
      }
    }
  }
  return files;
};

const findLatestLogFile = (dir: string) => {
  try {
    if (!fs.existsSync(dir)) {
      return null;
    }
    const files = collectLogFiles(dir);
    let latestFile: string | null = null;
    let latestMtime = 0;
    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        if (stat.mtimeMs > latestMtime) {
          latestFile = file;
          latestMtime = stat.mtimeMs;
        }
      } catch (err) {
        continue;
      }
    }
    return latestFile;
  } catch (err) {
    return null;
  }
};

const resolveLogTarget = (flags: TrackerFlags) => {
  if (flags.log) {
    const resolved = path.resolve(expandHome(flags.log));
    return { logFile: resolved, logDir: null };
  }

  const baseDir = flags.logDir
    ? expandHome(flags.logDir)
    : flags.cursorRoot
      ? path.join(expandHome(flags.cursorRoot), 'logs')
      : detectDefaultLogDir();

  const resolvedDir = path.resolve(baseDir);
  const latestLog = findLatestLogFile(resolvedDir);
  return { logFile: latestLog, logDir: resolvedDir };
};

const createLineReader = (filePath: string, fromStart: boolean) => {
  let offset = 0;
  let remainder = '';

  try {
    if (!fromStart) {
      offset = fs.statSync(filePath).size;
    }
  } catch (err) {
    offset = 0;
  }

  const readNewLines = () => {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      return [] as string[];
    }
    if (stat.size < offset) {
      offset = 0;
      remainder = '';
    }
    if (stat.size === offset) {
      return [] as string[];
    }
    const length = stat.size - offset;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, offset);
    } finally {
      fs.closeSync(fd);
    }
    offset = stat.size;
    const chunk = buffer.toString('utf-8');
    const combined = remainder + chunk;
    const lines = combined.split(/\r?\n/);
    remainder = lines.pop() || '';
    return lines;
  };

  return {
    readNewLines,
    reset: () => {
      offset = 0;
      remainder = '';
    },
  };
};

const trimLineNote = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= MAX_NOTE_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_NOTE_LENGTH)}...`;
};

export const startCursorTracker = (flags: TrackerFlags = {}) => {
  const target = resolveLogTarget(flags);
  if (!target.logFile) {
    error('Unable to locate Cursor log file. Use --log to specify one.');
    if (target.logDir) {
      warn(`Log directory checked: ${target.logDir}`);
    }
    return;
  }

  if (!fs.existsSync(target.logFile)) {
    error(`Log file not found: ${target.logFile}`);
    return;
  }

  const defaultEditor = flags.editor || DEFAULT_EDITOR;
  const defaultTitle = flags.title || DEFAULT_TITLE;
  const lastActiveByEditor = new Map<string, string>();
  let activeLogFile = target.logFile;
  let reader = createLineReader(activeLogFile, Boolean(flags.fromStart));
  let fileWatcher: chokidar.FSWatcher | null = null;
  let dirWatcher: chokidar.FSWatcher | null = null;

  const processLine = (line: string) => {
    if (!line || !line.trim()) {
      return;
    }
    const event = parseEvent(line);
    if (!event) {
      return;
    }

    const state = readState();
    const editor = (event.editor || defaultEditor || DEFAULT_EDITOR).trim();
    const title = (event.title || defaultTitle || DEFAULT_TITLE).trim();

    let resolvedId = event.id ? `cursor_${event.id}` : undefined;
    if (!resolvedId && event.status !== 'running') {
      const lastActive = lastActiveByEditor.get(editor);
      if (lastActive) {
        resolvedId = lastActive;
      }
    }
    if (!resolvedId) {
      const runningMatch = state.items.find(
        (item) => item.editor === editor && item.title === title && item.status === 'running'
      );
      if (runningMatch) {
        resolvedId = runningMatch.id;
      }
    }
    if (!resolvedId) {
      const seed = `${editor}|${title}`;
      resolvedId = createStableId(seed);
    }

    const existing = getItemById(state, resolvedId);
    const note =
      event.note !== undefined
        ? String(event.note)
        : flags.noteFromLog
          ? trimLineNote(line)
          : existing?.note || '';

    const next = upsertItem(state, {
      id: resolvedId,
      title: title || existing?.title || DEFAULT_TITLE,
      editor: editor || existing?.editor || DEFAULT_EDITOR,
      status: event.status,
      link: (event.link || flags.link || existing?.link || '').trim(),
      note,
    });

    state.updatedAt = new Date().toISOString();
    writeState(state);

    if (event.status === 'running') {
      lastActiveByEditor.set(next.editor, next.id);
    } else if (lastActiveByEditor.get(next.editor) === next.id) {
      lastActiveByEditor.delete(next.editor);
    }

    if (flags.print) {
      success(
        `[tracked] ${next.status} | ${next.editor} | ${next.title} | ${next.id}`
      );
    }
  };

  const processNewLines = () => {
    const lines = reader.readNewLines();
    for (const line of lines) {
      processLine(line);
    }
  };

  const switchLogFile = (nextFile: string) => {
    if (!nextFile || nextFile === activeLogFile) {
      return;
    }
    if (fileWatcher) {
      fileWatcher.close().catch(() => undefined);
    }
    activeLogFile = nextFile;
    reader = createLineReader(activeLogFile, Boolean(flags.fromStart));
    fileWatcher = chokidar.watch(activeLogFile, { ignoreInitial: true });
    fileWatcher.on('change', processNewLines);
    fileWatcher.on('error', (err) => warn(`Log watch error: ${err.message}`));
    fileWatcher.on('unlink', () => warn('Log file removed, waiting for new file.'));
    success(`Switched to log file: ${activeLogFile}`);
  };

  const startWatching = () => {
    fileWatcher = chokidar.watch(activeLogFile, { ignoreInitial: true });
    fileWatcher.on('change', processNewLines);
    fileWatcher.on('error', (err) => warn(`Log watch error: ${err.message}`));
    fileWatcher.on('unlink', () => warn('Log file removed, waiting for new file.'));

    if (target.logDir) {
      dirWatcher = chokidar.watch(target.logDir, { ignoreInitial: true, depth: 2 });
      dirWatcher.on('add', (filePath) => {
        if (filePath.endsWith('.log')) {
          const latest = findLatestLogFile(target.logDir);
          if (latest) {
            switchLogFile(latest);
          }
        }
      });
    }
  };

  success(`Cursor tracker watching: ${activeLogFile}`);
  success(`State file: ${STATE_PATH}`);
  if (target.logDir) {
    success(`Log directory: ${target.logDir}`);
  }

  if (flags.fromStart) {
    processNewLines();
  }

  if (flags.once) {
    return;
  }

  startWatching();

  process.on('SIGINT', () => {
    warn('Stopping cursor tracker...');
    if (fileWatcher) {
      fileWatcher.close().catch(() => undefined);
    }
    if (dirWatcher) {
      dirWatcher.close().catch(() => undefined);
    }
    process.exit(0);
  });
};
