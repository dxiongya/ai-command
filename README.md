## AI COMMAND QUESTION

### How to use?

1. Install Command
```
npm install ai-command
```

2. Config OpenAI API Key
```
aim set openai_key {YOUR_OPENAI_KEY}

// ls config check
aim ls
```

3. Ask Command Question in Terminal
```
// Input
aim ask "How to query port 3000, and close it"

// Output
lsof -i:3000 | kill -9 {PID}
```

4. Chat with Ai in Terminal
```
aim chat
```

5. Cursor Dashboard
```
// Start local dashboard
aim cursor --port 7337 --open
```

Notes:
- Cursor does not expose a public API for chat status. The dashboard stores data
  locally and requires manual updates (or your own automation writing to the
  state file).
- Use the "Link" field to store a deep link or URL that opens your editor.

6. Auto Copy
```
default open copy to clipboard, if you want to disable it, use --no-copy or global disbaled: aim set auto_copy off
```
