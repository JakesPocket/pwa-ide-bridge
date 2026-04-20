# AgentView - AI Chat Interface Documentation

## Overview

**AgentView** is a comprehensive AI-powered chat interface component that enables users to interact with multiple AI providers through an intuitive mobile-first interface. It provides real-time code execution, change management, and flexible interaction modes.

**Location**: `src/components/AgentView.jsx` (2,913 lines)

## Purpose

AgentView serves as the primary interface for:
- AI-powered conversations with multiple provider support (GitHub Copilot, OpenAI Codex, Local models)
- Autonomous code execution with real-time progress tracking
- File context sharing via attachments
- Code change review and management
- Background job execution for long-running tasks

---

## AI Interaction Modes

### 1. Agent Mode (Green)
- **Autonomous execution** without approval
- AI makes decisions and executes tools immediately
- Best for trusted, routine tasks

### 2. Ask Mode (Orange)
- **Approval required** before tool execution
- User reviews proposed actions before implementation
- Provides control over AI operations

### 3. Plan Mode (Blue)
- **Plan-first approach** - AI shows plan before execution
- User can execute, modify, or reject the plan
- No automatic tool execution

### 4. Cloud Mode (Cyan)
- **Background asynchronous execution**
- Jobs queue and run on server independently
- View progress in dedicated Cloud tab
- Ideal for long-running operations (>105 seconds)

---

## Architecture

### Execution Paths

AgentView supports two execution modes:

#### Chat Mode (Default)
- Real-time streaming responses via Server-Sent Events (SSE)
- Immediate feedback and interaction
- Auto-promotes to Cloud after 105 seconds
- Endpoint: `POST /api/chat`

#### Cloud Mode
- Background job execution
- Jobs tracked in separate Cloud tab
- Status polling every 4 seconds
- Can be queued, cancelled, or monitored
- Endpoints: `POST /api/jobs`, `GET /api/jobs`, `POST /api/jobs/{id}/cancel`

### State Management

AgentView uses React hooks (`useState`, `useEffect`) with localStorage persistence:

**Core State:**
- `messages` - Chat message history with streaming support
- `reasoning` - Internal AI reasoning display
- `attachments` - File context for AI
- `aiMode` - Current interaction mode (agent/ask/plan)
- `currentProvider` - Active AI provider
- `viewTab` - Active tab (chat/cloud)

**Change Management:**
- `changesSummary` - Git changes from AI operations
- `pendingReviewPaths` - Files awaiting user review
- `keptSignatures` - Approved file state snapshots

**Cloud Jobs:**
- `cloudJobs` - Background job status and history
- Auto-refreshes every 4 seconds

---

## Key Features

### 1. File Attachments

**Supported File Types:**
- Text files: `.txt`, `.md`, `.json`, `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.java`, `.cpp`, `.c`, `.h`, `.rb`, `.go`, `.rs`, `.php`, `.html`, `.css`, `.xml`, `.yaml`, `.yml`, `.sql`, `.sh`, `.bash`, `.csv`, `.log`, `.svg`
- Images: Visual context for AI
- Max file size: **10MB**

**Functions:**
- `handleFileSelect(e)` - Process file selection
- `readAttachmentFile(file)` - Read file content/preview
- `isTextFile(file)` - Validate file type

### 2. Streaming Response Handling

AgentView processes Server-Sent Events (SSE) from `/api/chat`:

| Event Type | Handler Action |
|------------|----------------|
| `reasoning` | Accumulates internal AI reasoning |
| `delta` | Appends text to active message bubble |
| `tool_call` | Creates tool execution message |
| `tool_result` | Updates tool with output |
| `message` | Finalizes text bubble |
| `plan_handoff` | Shows plan with continue options |
| `error` | Displays error with retry option |
| `done` | Finalizes all pending tool calls |

**Key Functions:**
- `sendPrompt(promptText)` - Main function for sending messages
- `finalizePendingToolCalls()` - Marks tool executions complete
- `handleAbort()` - Cancel streaming response

### 3. Change Management System

Real-time Git integration for tracking and managing AI-generated code changes:

**Features:**
- Polls Git changes every **15 seconds**
- File signatures track modifications (path/status/additions/deletions)
- Review panel shows pending changes with diff preview
- **Keep Changes** - Locks in modifications as baseline
- **Undo Changes** - Reverts files to pre-request state
- Integration with diff viewer for detailed review

**Functions:**
- `fetchChangesSummary()` - Get Git changes summary
- `handleKeepAgentChanges()` - Approve and lock changes
- `handleUndoAgentChanges()` - Revert agent modifications
- `getVisibleWorkspacePaths()` - Filter changed files
- `signatureByPath()` - Create file state fingerprints

**API Endpoints:**
- `GET /api/git/changes-summary` - Fetch changes summary
- `GET /api/git/changes-diff` - Get detailed diffs
- `POST /api/git/discard-changes` - Undo changes
- `POST /api/git/keep-snapshot` - Lock in changes

### 4. Cloud Jobs Management

Background execution with status tracking:

**Job States:**
- `queued` - Waiting to execute
- `running` - Currently executing
- `succeeded` - Completed successfully
- `failed` - Error occurred
- `cancelled` - User cancelled

**Features:**
- Poll job status every **4 seconds**
- Cancel queued or running jobs
- View job results and errors
- Job history persistence

**Functions:**
- `fetchCloudJobs()` - Poll job status
- `createCloudJob()` - Create background job
- `handleCancelCloudJob(jobId)` - Cancel job

### 5. Auto-Cloud Promotion

Long-running chat requests automatically promote to cloud execution:

- Triggers after **105 seconds** of streaming
- Configurable: 10-240 seconds via `pocketcode.agent.chatAutoCloudMs.v1`
- User notification on promotion
- Seamless transition to Cloud tab

---

## Message Structure

```javascript
{
  id: string,           // Unique message identifier
  turnId: string,       // Conversation turn ID
  role: string,         // 'user' | 'agent' | 'tool' | 'error' | 'reasoning' | 'handoff'
  text?: string,        // Message content
  streaming?: boolean,  // Currently streaming
  aiMode?: string,      // Mode used: 'agent' | 'ask' | 'plan' | 'cloud'
  tool?: string,        // Tool name (for tool messages)
  input?: object,       // Tool input parameters
  output?: object,      // Tool execution result
  done?: boolean,       // Tool completion status
  attachments?: array,  // Attached files
  isTimeout?: boolean,  // Timeout error flag
  isLoop?: boolean,     // Loop error flag
}
```

---

## UI Components

### Main Layout Structure

```
┌─────────────────────────────────────┐
│ Tabs: [Chat] [Cloud]                │
│ Provider Badge (Copilot/Codex/...)  │
├─────────────────────────────────────┤
│                                     │
│  Message Scroll Area                │
│  ├─ User Bubbles (green/orange/blue)│
│  ├─ Agent Bubbles (with code blocks)│
│  ├─ Tool Execution Timeline         │
│  ├─ Reasoning Display (collapsible) │
│  ├─ Error Bubbles (with retry)      │
│  └─ Thinking Placeholder            │
│                                     │
├─────────────────────────────────────┤
│ Composer Area                       │
│ ├─ Attachment Preview               │
│ ├─ Dynamic Textarea (48-92px)       │
│ ├─ Word/Char Counter                │
│ ├─ Send Button (hold for mode menu) │
│ └─ Changes Review Panel             │
│    ├─ Changes Summary (+X/-Y)       │
│    ├─ Keep/Undo Buttons             │
│    └─ File List with Diffs          │
└─────────────────────────────────────┘
```

### Message Bubble Components

1. **UserBubble** - User messages with mode indicator badge
2. **AgentBubble** - AI responses with markdown and code block parsing
3. **CodeBlock** - Syntax-highlighted code with copy button
4. **ToolCallBubble** - Tool execution with collapsible input/output
5. **ToolTimelineRow** - Visual timeline entry for tool execution
6. **ReasoningBubble** - Collapsible internal AI reasoning
7. **ThinkingPlaceholderBubble** - Loading state when quiet >1.2s
8. **ErrorBubble** - Error messages with continue/retry options
9. **TurnResponseGroup** - Grouped agent responses per conversation turn

---

## Core Functions Reference

### Message Sending
- `sendPrompt(promptText)` - Send message and stream response
- `handleSend(e)` - Form submit handler
- `handleSubmitButtonClick()` - Send with mode selection
- `buildSubmitLongPressHandlers()` - 350ms hold for mode menu

### Change Management
- `fetchChangesSummary()` - Poll Git changes (15s interval)
- `handleKeepAgentChanges()` - Lock in modifications
- `handleUndoAgentChanges()` - Revert agent changes
- `getVisibleWorkspacePaths()` - Filter changed files
- `signatureByPath()` - Create file state fingerprint

### Cloud Jobs
- `fetchCloudJobs()` - Poll job status (4s interval)
- `createCloudJob()` - Create background job
- `handleCancelCloudJob(jobId)` - Cancel job

### Message Processing
- `finalizePendingToolCalls()` - Complete tool executions
- `buildRenderItems(messages)` - Group messages by turn
- `normalizeStoredMessage()` - Validate message structure

### File Attachments
- `handleFileSelect(e)` - Process file selection
- `readAttachmentFile(file)` - Read file content (max 10MB)
- `isTextFile(file)` - Check file type

### UI Interactions
- `handleMessagesScroll(e)` - Track scroll position
- `scrollToBottom()` - Jump to latest message
- `scrollToPrevPrompt()` - Navigate to previous user message
- `scrollToNextPrompt()` - Navigate to next user message
- `buildLongPressHandlers(payload)` - 300-800ms press for context menu
- `handleRetryFromContextMenu()` - Resend failed message
- `handleOpenAllEdits()` - Open diff viewer for all changes

### Utilities
- `formatFileSize(bytes)` - Human-readable file sizes (B/KB/MB)
- `formatToolPayload(value)` - Truncate tool inputs/outputs
- `providerDisplayName(provider)` - Map provider names
- `splitCodeBlocks(text)` - Parse markdown code blocks
- `copyTextToClipboard(text)` - Copy with fallback support

---

## API Integration

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat` | POST | Stream AI responses via SSE |
| `/api/jobs` | GET | Fetch cloud jobs list |
| `/api/jobs` | POST | Create new cloud job |
| `/api/jobs/{id}/cancel` | POST | Cancel running job |
| `/api/git/changes-summary` | GET | Get Git changes summary |
| `/api/git/changes-diff` | GET | Get detailed file diffs |
| `/api/git/discard-changes` | POST | Undo agent changes |
| `/api/git/keep-snapshot` | POST | Lock in agent changes |

---

## Configuration & Constants

### Timing Constants

```javascript
REQUEST_TIMEOUT_MS = 300000              // 5 minutes
CHAT_AUTO_CLOUD_AFTER_MS = 105000        // Auto-promote at 1m45s
MESSAGE_LONG_PRESS_MIN_MS = 300          // Context menu min
MESSAGE_LONG_PRESS_MAX_MS = 800          // Context menu max
COMPOSER_MODE_HOLD_MS = 350              // Mode menu trigger
ATTACHMENT_CONTEXT_HINT_FADE_MS = 1600   // Hint fade duration
COPY_STATUS_TIMEOUT_MS = 1400            // Copy feedback
```

### Composer Dimensions

```javascript
COMPOSER_MIN_HEIGHT_PX = 48              // Single line
COMPOSER_MAX_HEIGHT_PX = 92              // ~4 lines max
COMPOSER_ACTION_BUTTON_SIZE_PX = 50      // Send button size
```

### Polling Intervals

- **Git changes**: 15 seconds
- **Cloud jobs**: 4 seconds
- **AI mode sync**: 500ms
- **Provider sync**: 300ms

### Mode Colors

```javascript
MODE_BUBBLE_COLORS = {
  agent: rgb(100, 200, 100),   // Green
  ask:   rgb(255, 165, 0),     // Orange
  plan:  rgb(100, 150, 255),   // Blue
  cloud: rgb(0, 200, 255),     // Cyan
}
```

---

## Storage & Persistence

### localStorage Keys

| Key | Purpose |
|-----|---------|
| `pocketcode.agent.messages.v1` | Chat message history |
| `pocketcode.agent.input.v1` | Current composer input |
| `pocketcode.agent.pendingReviewPaths.v1` | Files awaiting review |
| `pocketcode.agent.ai.mode.v1` | Selected AI mode |
| `pocketcode.agent.ai.provider.v1` | Selected provider |
| `pocketcode.agent.ai.execution.v1` | Chat vs Cloud mode |
| `pocketcode.agent.turnAiMode.v1` | Per-turn AI modes |
| `pocketcode.agent.turnProvider.v1` | Per-turn providers |
| `pocketcode.agent.cloudJobs.v1` | Cloud job history |
| `pocketcode.agent.activeSubTab.v1` | Active tab (chat/cloud) |
| `pocketcode.agent.chatAutoCloudMs.v1` | Auto-promotion timeout |

**Persistence:**
- Automatic save via `useEffect` on state changes
- Lazy load on component mount
- Per-turn tracking for modes and providers

---

## Mobile & Accessibility Features

### Mobile Optimizations

- **Scroll prevention** on focus using `preventScrollOnFocus` utility
- **Touch-friendly** button sizing (50px minimum)
- **Dynamic textarea** height (48-92px range)
- **Modal context menus** for long-press actions
- **Wake lock** prevents screen sleep during streaming
- **Overscroll containment** for smooth scrolling

### Gesture Support

- **Long-press detection** (300-800ms) for context menus
- **Hold-to-select mode** (350ms) on send button
- **Respects text selection** - doesn't trigger when selecting text
- **Scroll momentum** with `overscroll-y-contain`

### Accessibility

- Semantic HTML (`<form>`, `<button>`, `<textarea>`)
- ARIA labels and roles (`role="tab"`, `aria-selected`)
- Keyboard support (Enter to send, form submit)
- High-contrast mode support with VSCode theme variables
- Screen reader friendly message structure

---

## Performance Optimizations

### React Optimizations

**useMemo hooks for expensive computations:**
- `composerCounts` - Word/character counting
- `composerMetricVisibility` - Layout decision making
- `renderItems` - Message grouping by turn
- `activeTurnMessages` - Filtered message lists
- `currentSignatures` - File state calculations

### Rendering Optimizations

- **Delta streaming** - Appends text without full re-renders
- **Immediate scroll** during streaming (no smooth animation)
- **Lazy textarea height** updates on input change only
- **Efficient polling** with cleanup on unmount

---

## Error Handling

### Network Errors

- **Client disconnect detection** via `isLikelyClientDisconnectError()`
- **5-minute timeout** for long-running requests
- **Manual abort/retry** via context menu
- **Error bubbles** with retry option

### Tool Execution Errors

- Catches and displays tool errors
- Finalizes pending tools with error state
- Shows error message with option to continue conversation

### File Operations

- **Size validation** - Max 10MB per file
- **Type validation** - Text and image support
- **Graceful fallbacks** for unsupported types
- **Error handling** for Git operations

---

## Integration Points

### Props

- `onOpenDiffFiles` - Callback to open diff viewer for file changes

### Parent Component (App.jsx)

- Renders AgentView on 'ai-agent' tab (default)
- Provides workspace context via `workspaceEpoch` key
- Passes file diff handler for change review

### Settings Integration (SettingsView.jsx)

- Reads/writes AI provider configuration
- Configures execution mode preference
- Manages authentication with providers
- Updates model selection per provider

---

## Related Files

- **App.jsx** - Main application router and layout
- **SettingsView.jsx** - AI provider configuration
- **Layout.jsx** - Navigation and tabs
- **utils/persist.js** - localStorage persistence API
- **utils/preventScrollOnFocus.js** - Mobile scroll handling
- **config/server.js** - API URL configuration

---

## Future Enhancements

Based on the current architecture, potential improvements could include:

- **Conversation branching** - Fork conversations from any point
- **Template messages** - Pre-defined prompts for common tasks
- **Voice input** - Speech-to-text for hands-free operation
- **Collaborative sessions** - Share AI conversations with team
- **Advanced filtering** - Search and filter message history
- **Export conversations** - Save conversations as markdown/JSON
- **Custom tools** - User-defined tool integrations
- **Multi-file diff** - Side-by-side comparison for multiple files

---

## Summary

AgentView is a feature-rich, mobile-first AI chat interface that provides:

✅ **Multi-mode AI interaction** (Agent, Ask, Plan, Cloud)  
✅ **Real-time streaming** with tool execution tracking  
✅ **Change management** with Git integration  
✅ **File attachments** for context sharing  
✅ **Background job execution** for long-running tasks  
✅ **Mobile-optimized** with gesture support  
✅ **Persistent state** across sessions  
✅ **Multiple AI providers** (Copilot, Codex, Local)  
✅ **Responsive UI** with accessibility features  

The component serves as the core interface for AI-powered development workflows in PocketCode, enabling users to interact with AI assistants effectively on mobile and desktop platforms.
