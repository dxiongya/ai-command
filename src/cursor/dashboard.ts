import http from 'http';
import { exec } from 'child_process';
import { URL } from 'url';
import { error, success, warn } from '../utils/log';
import { deleteItem, readState, upsertItem, writeState, STATE_PATH } from './state';

type DashboardFlags = {
  port?: string | number;
  host?: string;
  open?: boolean;
};

const DEFAULT_PORT = 7337;
const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 1024 * 1024;

const HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cursor Chat Dashboard</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #0b0c10;
        color: #e6e7e8;
      }
      a {
        color: #74c0ff;
      }
      .container {
        max-width: 1100px;
        margin: 0 auto;
        padding: 24px;
      }
      h1 {
        margin: 0 0 8px;
      }
      .hint {
        margin: 0 0 20px;
        color: #b6b9bb;
        font-size: 14px;
      }
      .panel {
        background: #15181f;
        border: 1px solid #2a2f3a;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 16px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      label {
        display: block;
        font-size: 12px;
        color: #b6b9bb;
        margin-bottom: 4px;
      }
      input, select, textarea {
        width: 100%;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid #2a2f3a;
        background: #0f1116;
        color: #e6e7e8;
        box-sizing: border-box;
      }
      textarea {
        min-height: 70px;
        resize: vertical;
      }
      button {
        padding: 8px 14px;
        border-radius: 8px;
        border: 1px solid #3a4151;
        background: #1e2430;
        color: #e6e7e8;
        cursor: pointer;
      }
      button.primary {
        background: #246bce;
        border-color: #246bce;
      }
      button.danger {
        background: #7d2b2b;
        border-color: #7d2b2b;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th, td {
        padding: 10px;
        border-bottom: 1px solid #2a2f3a;
        text-align: left;
        vertical-align: top;
      }
      th {
        color: #b6b9bb;
        font-weight: 500;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 12px;
        border: 1px solid transparent;
      }
      .status.pending { background: #3a3a3a; border-color: #4a4a4a; }
      .status.running { background: #2d3b55; border-color: #3c4f75; }
      .status.success { background: #1f4b2d; border-color: #2f6d43; }
      .status.failed { background: #5a2626; border-color: #7a3535; }
      .toolbar {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .footer {
        color: #8a8f98;
        font-size: 12px;
        margin-top: 12px;
      }
      .actions {
        display: flex;
        gap: 6px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Cursor Chat Dashboard</h1>
      <p class="hint">
        This dashboard stores status locally. Cursor does not expose a public API
        for chat status, so update items manually or via your own automation.
      </p>

      <div class="panel">
        <div class="toolbar">
          <h2 style="margin:0;">Upsert item</h2>
          <span id="edit-indicator" class="hint"></span>
        </div>
        <form id="item-form">
          <div class="grid">
            <div>
              <label for="title">Title</label>
              <input id="title" name="title" placeholder="Chat topic" required />
            </div>
            <div>
              <label for="editor">Editor</label>
              <input id="editor" name="editor" placeholder="Workspace or window name" required />
            </div>
            <div>
              <label for="status">Status</label>
              <select id="status" name="status">
                <option value="pending">pending</option>
                <option value="running">running</option>
                <option value="success">success</option>
                <option value="failed">failed</option>
              </select>
            </div>
            <div>
              <label for="link">Link</label>
              <input id="link" name="link" placeholder="Deep link or URL" />
            </div>
          </div>
          <div style="margin-top:12px;">
            <label for="note">Note</label>
            <textarea id="note" name="note" placeholder="Optional note or last message"></textarea>
          </div>
          <div class="actions" style="margin-top:12px;">
            <button class="primary" type="submit" id="save-button">Save</button>
            <button type="button" id="clear-button">Clear</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <div class="toolbar">
          <h2 style="margin:0;">Items</h2>
          <div class="actions">
            <button type="button" id="refresh-button">Refresh</button>
          </div>
        </div>
        <div id="stats" class="footer"></div>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Title</th>
              <th>Editor</th>
              <th>Note</th>
              <th>Updated</th>
              <th>Link</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="items-body"></tbody>
        </table>
      </div>

      <div class="footer">
        State file: <span id="state-path"></span>
      </div>
    </div>

    <script>
      const statePath = '';
      const itemsBody = document.getElementById('items-body');
      const stats = document.getElementById('stats');
      const statePathEl = document.getElementById('state-path');
      const form = document.getElementById('item-form');
      const editIndicator = document.getElementById('edit-indicator');
      const refreshButton = document.getElementById('refresh-button');
      const clearButton = document.getElementById('clear-button');
      const saveButton = document.getElementById('save-button');
      const fieldTitle = document.getElementById('title');
      const fieldEditor = document.getElementById('editor');
      const fieldStatus = document.getElementById('status');
      const fieldLink = document.getElementById('link');
      const fieldNote = document.getElementById('note');

      let currentState = { items: [] };
      let editingId = null;

      function setEditing(item) {
        editingId = item ? item.id : null;
        editIndicator.textContent = item ? 'Editing: ' + item.id : '';
        saveButton.textContent = item ? 'Update' : 'Save';
      }

      function clearForm() {
        form.reset();
        setEditing(null);
      }

      function renderStats(items) {
        const counts = items.reduce((acc, item) => {
          acc[item.status] = (acc[item.status] || 0) + 1;
          return acc;
        }, {});
        stats.textContent = 'Total: ' + items.length + ' | pending: ' + (counts.pending || 0)
          + ' | running: ' + (counts.running || 0) + ' | success: ' + (counts.success || 0)
          + ' | failed: ' + (counts.failed || 0);
      }

      function createCell(text) {
        const td = document.createElement('td');
        td.textContent = text || '';
        return td;
      }

      function render(items) {
        itemsBody.innerHTML = '';
        items.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).forEach((item) => {
          const row = document.createElement('tr');
          const statusCell = document.createElement('td');
          const badge = document.createElement('span');
          badge.className = 'status ' + item.status;
          badge.textContent = item.status;
          statusCell.appendChild(badge);
          row.appendChild(statusCell);
          row.appendChild(createCell(item.title));
          row.appendChild(createCell(item.editor));
          row.appendChild(createCell(item.note));
          row.appendChild(createCell(item.updatedAt));

          const linkCell = document.createElement('td');
          if (item.link) {
            const link = document.createElement('a');
            link.href = item.link;
            link.textContent = 'Open';
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            linkCell.appendChild(link);
          }
          row.appendChild(linkCell);

          const actionCell = document.createElement('td');
          const editButton = document.createElement('button');
          editButton.textContent = 'Edit';
          editButton.addEventListener('click', () => {
            fieldTitle.value = item.title || '';
            fieldEditor.value = item.editor || '';
            fieldStatus.value = item.status || 'pending';
            fieldLink.value = item.link || '';
            fieldNote.value = item.note || '';
            setEditing(item);
          });
          const deleteButton = document.createElement('button');
          deleteButton.textContent = 'Delete';
          deleteButton.className = 'danger';
          deleteButton.addEventListener('click', async () => {
            await deleteItem(item.id);
          });
          const actionWrap = document.createElement('div');
          actionWrap.className = 'actions';
          actionWrap.appendChild(editButton);
          actionWrap.appendChild(deleteButton);
          actionCell.appendChild(actionWrap);
          row.appendChild(actionCell);

          itemsBody.appendChild(row);
        });
      }

      async function loadState() {
        const response = await fetch('/api/state');
        const payload = await response.json();
        currentState = payload.state || { items: [] };
        statePathEl.textContent = payload.path || '';
        renderStats(currentState.items);
        render(currentState.items);
      }

      async function upsertItem(item) {
        await fetch('/api/item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item })
        });
        await loadState();
      }

      async function deleteItem(id) {
        await fetch('/api/item/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        await loadState();
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const item = {
          id: editingId || undefined,
          title: fieldTitle.value.trim(),
          editor: fieldEditor.value.trim(),
          status: fieldStatus.value,
          link: fieldLink.value.trim(),
          note: fieldNote.value.trim()
        };
        await upsertItem(item);
        clearForm();
      });

      clearButton.addEventListener('click', () => {
        clearForm();
      });

      refreshButton.addEventListener('click', async () => {
        await loadState();
      });

      loadState();
      setInterval(loadState, 5000);
    </script>
  </body>
</html>`;


const readBody = async (req: http.IncomingMessage): Promise<string> => {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
};

const sendJson = (
  res: http.ServerResponse,
  statusCode: number,
  payload: any
) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
};

const openInBrowser = (url: string) => {
  const platform = process.platform;
  const escapedUrl = url.replace(/"/g, '\\"');
  let command = '';
  if (platform === 'win32') {
    command = `start "" "${escapedUrl}"`;
  } else if (platform === 'darwin') {
    command = `open "${escapedUrl}"`;
  } else {
    command = `xdg-open "${escapedUrl}"`;
  }
  exec(command, (err) => {
    if (err) {
      warn(`Failed to open browser: ${err.message}`);
    }
  });
};

export const startCursorDashboard = (flags: DashboardFlags = {}) => {
  const port =
    typeof flags.port === 'number'
      ? flags.port
      : Number(flags.port ?? DEFAULT_PORT) || DEFAULT_PORT;
  const host = flags.host || DEFAULT_HOST;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}:${port}`);
      const pathname = url.pathname;

      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(HTML);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/state') {
        const state = readState();
        sendJson(res, 200, { state, path: STATE_PATH });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/item') {
        const body = await readBody(req);
        const payload = JSON.parse(body || '{}');
        const state = readState();
        upsertItem(state, payload.item || {});
        state.updatedAt = new Date().toISOString();
        writeState(state);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/item/delete') {
        const body = await readBody(req);
        const payload = JSON.parse(body || '{}');
        const state = readState();
        if (payload.id) {
          deleteItem(state, String(payload.id));
        }
        state.updatedAt = new Date().toISOString();
        writeState(state);
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err: any) {
      sendJson(res, 500, { error: err?.message || 'Server error' });
    }
  });

  server.on('error', (err) => {
    error(`Dashboard server error: ${err.message}`);
  });

  server.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    success(`Cursor dashboard running at ${url}`);
    success(`State file: ${STATE_PATH}`);
    if (flags.open) {
      openInBrowser(url);
    }
  });

  process.on('SIGINT', () => {
    warn('Shutting down dashboard...');
    server.close(() => {
      process.exit(0);
    });
  });
};
