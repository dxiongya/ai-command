import fs from 'fs';
import os from 'os';
import path from 'path';
import { warn } from '../utils/log';

export type DashboardStatus = 'pending' | 'running' | 'success' | 'failed';

export type DashboardItem = {
  id: string;
  title: string;
  editor: string;
  status: DashboardStatus;
  link?: string;
  note?: string;
  updatedAt: string;
};

export type DashboardState = {
  updatedAt: string;
  items: DashboardItem[];
};

const DATA_DIR = path.join(os.homedir(), '.ai-command');
export const STATE_PATH = path.join(DATA_DIR, 'cursor-dashboard.json');

const defaultState = (): DashboardState => ({
  updatedAt: new Date().toISOString(),
  items: [],
});

const ensureStateFile = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(defaultState(), null, 2));
  }
};

export const readState = (): DashboardState => {
  ensureStateFile();
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
      throw new Error('Invalid state format');
    }
    return parsed;
  } catch (err) {
    const backupPath = `${STATE_PATH}.bak-${Date.now()}`;
    try {
      fs.renameSync(STATE_PATH, backupPath);
      warn(`State file was invalid. Backed up to ${backupPath}`);
    } catch (backupError) {
      warn('Failed to backup invalid state file.');
    }
    const state = defaultState();
    writeState(state);
    return state;
  }
};

export const writeState = (state: DashboardState) => {
  ensureStateFile();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
};

const createId = () =>
  `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const normalizeStatus = (
  status: unknown,
  fallback: DashboardStatus
): DashboardStatus => {
  const allowed: DashboardStatus[] = ['pending', 'running', 'success', 'failed'];
  if (typeof status === 'string' && allowed.includes(status as DashboardStatus)) {
    return status as DashboardStatus;
  }
  return fallback;
};

export const getItemById = (state: DashboardState, id: string) => {
  return state.items.find((item) => item.id === id);
};

export const upsertItem = (
  state: DashboardState,
  input: Partial<DashboardItem>
): DashboardItem => {
  const now = new Date().toISOString();
  const existingIndex = input.id
    ? state.items.findIndex((item) => item.id === input.id)
    : -1;
  const base =
    existingIndex >= 0
      ? state.items[existingIndex]
      : {
          id: input.id || createId(),
          title: '',
          editor: '',
          status: 'pending' as DashboardStatus,
          link: '',
          note: '',
          updatedAt: now,
        };

  const next: DashboardItem = {
    id: base.id,
    title: String(input.title ?? base.title ?? '').trim(),
    editor: String(input.editor ?? base.editor ?? '').trim(),
    status: normalizeStatus(input.status, base.status),
    link: String(input.link ?? base.link ?? '').trim(),
    note: String(input.note ?? base.note ?? '').trim(),
    updatedAt: now,
  };

  if (!next.title || !next.editor) {
    throw new Error('title and editor are required');
  }

  if (existingIndex >= 0) {
    state.items[existingIndex] = next;
  } else {
    state.items.push(next);
  }

  return next;
};

export const deleteItem = (state: DashboardState, id: string) => {
  state.items = state.items.filter((item) => item.id !== id);
};
