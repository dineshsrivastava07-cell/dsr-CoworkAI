// Utility functions for tool use/result display
import {
  Terminal,
  FileCode,
  FileText,
  Pencil,
  Search,
  Globe,
  FolderSearch,
  MousePointer2,
  Keyboard,
  Monitor,
} from 'lucide-react';

/** Extract the bare GUI_Operate action name from an mcp__GUI_Operate__<action> tool name. */
function guiOperateAction(name: string): string | null {
  const match = name.match(/^mcp__GUI_Operate__(.+)$/);
  return match?.[1] ?? null;
}

const GUI_OPERATE_CURSOR_ACTIONS = new Set([
  'click',
  'drag',
  'scroll',
  'move_mouse',
  'get_mouse_position',
]);
const GUI_OPERATE_KEYBOARD_ACTIONS = new Set(['type_text', 'key_press']);
const GUI_OPERATE_SCREEN_ACTIONS = new Set([
  'screenshot',
  'screenshot_for_display',
  'get_displays',
  'gui_locate_element',
  'gui_verify_vision',
  'gui_extract_info',
]);

/** Actions that actually move the real mouse/keyboard, as opposed to passive reads (screenshot, get_displays). */
const GUI_OPERATE_INPUT_CONTROL_ACTIONS = new Set([
  'click',
  'drag',
  'scroll',
  'move_mouse',
  'type_text',
  'key_press',
]);

/** True when `toolName` is a GUI_Operate action that drives the real mouse/keyboard. */
export function isGuiOperateControlAction(toolName: string): boolean {
  const action = guiOperateAction(toolName);
  return action !== null && GUI_OPERATE_INPUT_CONTROL_ACTIONS.has(action);
}

/** Map a tool name to a small icon element */
export function getToolIcon(name: string) {
  const n = name.toLowerCase();
  if (n === 'bash' || n === 'execute_command') return <Terminal className="w-3.5 h-3.5" />;
  if (n === 'read' || n === 'read_file') return <FileCode className="w-3.5 h-3.5" />;
  if (n === 'write' || n === 'write_file') return <FileText className="w-3.5 h-3.5" />;
  if (n === 'edit' || n === 'edit_file') return <Pencil className="w-3.5 h-3.5" />;
  if (n === 'grep') return <Search className="w-3.5 h-3.5" />;
  if (n === 'glob') return <FolderSearch className="w-3.5 h-3.5" />;
  if (n === 'websearch') return <Globe className="w-3.5 h-3.5" />;
  if (n === 'webfetch') return <Globe className="w-3.5 h-3.5" />;

  const action = guiOperateAction(name);
  if (action) {
    if (GUI_OPERATE_CURSOR_ACTIONS.has(action)) return <MousePointer2 className="w-3.5 h-3.5" />;
    if (GUI_OPERATE_KEYBOARD_ACTIONS.has(action)) return <Keyboard className="w-3.5 h-3.5" />;
    if (GUI_OPERATE_SCREEN_ACTIONS.has(action)) return <Monitor className="w-3.5 h-3.5" />;
    return <MousePointer2 className="w-3.5 h-3.5" />;
  }

  return <Terminal className="w-3.5 h-3.5" />;
}

/** Shorten a file path to just filename or last 2 segments */
export function shortenPath(p: string): string {
  if (typeof p !== 'string') return String(p);
  const segments = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.length <= 2) return segments.join('/');
  return segments.slice(-2).join('/');
}

export function getMcpToolDisplayName(name: string, displayName?: string): string {
  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    return displayName;
  }

  if (name.startsWith('mcp__')) {
    const match = name.match(/^mcp__(.+?)__(.+)$/);
    return match?.[2] || name;
  }

  return name;
}

/** Compact label for a GUI_Operate action, or null if this isn't one / has no special case. */
function getGuiOperateLabel(name: string, input: Record<string, unknown>): string | null {
  const action = name.match(/^mcp__GUI_Operate__(.+)$/)?.[1];
  if (!action) return null;

  if (action === 'click') {
    const x = input.x;
    const y = input.y;
    const type = typeof input.click_type === 'string' ? input.click_type : 'single';
    const prefix = type === 'double' ? 'Double-click' : type === 'right' ? 'Right-click' : 'Click';
    return x !== undefined && y !== undefined ? `${prefix} at (${x}, ${y})` : prefix;
  }
  if (action === 'drag') {
    const { from_x, from_y, to_x, to_y } = input;
    if (from_x !== undefined && to_x !== undefined) {
      return `Drag (${from_x}, ${from_y}) → (${to_x}, ${to_y})`;
    }
    return 'Drag cursor';
  }
  if (action === 'move_mouse') {
    const x = input.x;
    const y = input.y;
    return x !== undefined && y !== undefined ? `Move cursor to (${x}, ${y})` : 'Move cursor';
  }
  if (action === 'scroll') {
    const dir = typeof input.direction === 'string' ? input.direction : '';
    return dir ? `Scroll ${dir}` : 'Scroll';
  }
  if (action === 'type_text') {
    const text = typeof input.text === 'string' ? input.text : '';
    const short = text.length > 40 ? text.substring(0, 37) + '...' : text;
    return short ? `Type "${short}"` : 'Type text';
  }
  if (action === 'key_press') {
    const key = typeof input.key === 'string' ? input.key : '';
    const modifiers = Array.isArray(input.modifiers) ? input.modifiers.join('+') : '';
    return key ? `Press ${modifiers ? `${modifiers}+` : ''}${key}` : 'Press key';
  }
  if (action === 'screenshot' || action === 'screenshot_for_display') {
    return 'Take screenshot';
  }

  return null;
}

/** Get compact label: tool action + key argument */
export function getToolLabel(
  name: string,
  input: Record<string, unknown>,
  displayName?: string
): string {
  const inp = input || {};
  // MCP tools
  if (name.startsWith('mcp__')) {
    const guiOperateLabel = getGuiOperateLabel(name, inp);
    if (guiOperateLabel) return guiOperateLabel;
    return getMcpToolDisplayName(name, displayName);
  }

  const nameLower = name.toLowerCase();
  if (nameLower === 'read' || nameLower === 'read_file') {
    const p = String(inp.file_path || inp.path || '');
    return p ? `Read ${shortenPath(p)}` : 'Read file';
  }
  if (nameLower === 'write' || nameLower === 'write_file') {
    const p = String(inp.file_path || inp.path || '');
    return p ? `Write ${shortenPath(p)}` : 'Write file';
  }
  if (nameLower === 'edit' || nameLower === 'edit_file') {
    const p = String(inp.file_path || inp.path || '');
    return p ? `Edit ${shortenPath(p)}` : 'Edit file';
  }
  if (nameLower === 'bash' || nameLower === 'execute_command') {
    const cmd = String(inp.command || inp.cmd || '');
    if (cmd) {
      const short = cmd.length > 60 ? cmd.substring(0, 57) + '...' : cmd;
      return `$ ${short}`;
    }
    return 'Run command';
  }
  if (nameLower === 'glob') return inp.pattern ? `Glob ${String(inp.pattern)}` : 'Glob';
  if (nameLower === 'grep') return inp.pattern ? `Grep "${String(inp.pattern)}"` : 'Grep';
  if (nameLower === 'websearch') return inp.query ? `Search "${String(inp.query)}"` : 'Web search';
  if (nameLower === 'webfetch') {
    const url = String(inp.url || '');
    return url ? `Fetch ${url.length > 50 ? url.substring(0, 47) + '...' : url}` : 'Fetch URL';
  }
  return name;
}
