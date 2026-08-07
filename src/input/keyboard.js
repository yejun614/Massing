/**
 * Keyboard shortcuts.
 *
 * Clipboard work is done through the native `copy`/`cut`/`paste` events rather
 * than the async Clipboard API: those events carry the data synchronously and
 * need no permission prompt. The async API in `commands` stays for the toolbar
 * buttons, which have no such event to ride on.
 */

import { isTextTarget } from './pointer.js';
import { serializeDoc } from '../core/schema.js';

export const SHORTCUTS = [
  ['Ctrl/Cmd + S', 'Save'],
  ['Ctrl/Cmd + O', 'Open'],
  ['R', 'Reload the open file from disk'],
  ['Ctrl/Cmd + Z', 'Undo'],
  ['Ctrl/Cmd + Shift + Z', 'Redo'],
  ['Ctrl/Cmd + C / X / V', 'Copy / cut / paste as JSON'],
  ['Ctrl/Cmd + D', 'Duplicate'],
  ['Ctrl/Cmd + A', 'Select all'],
  ['Delete', 'Delete selection'],
  ['Arrows', 'Nudge (Shift for 5 cells)'],
  ['Q / E', 'Rotate the view'],
  ['C', 'Connect tool'],
  ['G', 'Draw a zone'],
  ['T', 'Add a text annotation'],
  ['A', 'Tidy — separate anything hidden'],
  ['Shift + A', 'Auto layout from the connections'],
  ['V', 'Select tool'],
  ['H', 'Pan tool'],
  ['2', 'Toggle 2D / 3D'],
  ['0', 'Zoom to fit'],
  ['Space + drag', 'Pan'],
  ['[ / ]', 'Show or hide the left / right panel'],
  ['Drag a panel edge', 'Resize the side panels (double-click to reset)'],
];

export function attachKeyboard({ store, commands, io, panels }) {
  function onKeyDown(e) {
    if (isTextTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (mod) {
      switch (key) {
        case 'z':
          e.preventDefault();
          e.shiftKey ? commands.redo() : commands.undo();
          return;
        case 'y':
          e.preventDefault();
          commands.redo();
          return;
        case 'a':
          e.preventDefault();
          commands.selectAll();
          return;
        case 'd':
          e.preventDefault();
          commands.duplicate();
          return;
        case 's':
          e.preventDefault();
          io?.save({ saveAs: e.shiftKey });
          return;
        case 'o':
          e.preventDefault();
          io?.open();
          return;
        case 'n':
          e.preventDefault();
          commands.newDoc();
          return;
        default:
          return; // leave every other browser shortcut alone
      }
    }

    switch (key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        commands.deleteSelection();
        break;
      case 'Escape':
        store.setUI({ pendingType: null, tool: 'select' });
        store.clearSelection();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        commands.nudge(e.shiftKey ? -5 : -1, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        commands.nudge(e.shiftKey ? 5 : 1, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        commands.nudge(0, e.shiftKey ? -5 : -1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        commands.nudge(0, e.shiftKey ? 5 : 1);
        break;
      case 'q':
        commands.rotateLeft();
        break;
      case 'e':
        commands.rotateRight();
        break;
      case 'v':
        commands.setTool('select');
        break;
      case 'h':
        commands.setTool('pan');
        break;
      // Plain R, because Ctrl+R belongs to the browser -- and reloading the
      // page instead of the diagram is exactly the mistake to design out.
      case 'r':
        io?.reload();
        break;
      case 'g':
        commands.setTool('group');
        break;
      case 't':
        commands.setTool('text');
        break;
      case 'a':
        e.shiftKey ? commands.autoLayout() : commands.tidy();
        break;
      case '2':
        commands.toggleMode();
        break;
      case '0':
        commands.zoomFit();
        break;
      case '1':
        commands.zoomReset();
        break;
      case '=':
      case '+':
        commands.zoomIn();
        break;
      case '-':
        commands.zoomOut();
        break;
      case '[':
        panels?.toggle('left');
        break;
      case ']':
        panels?.toggle('right');
        break;
      default:
        break;
    }
  }

  function onCopy(e, alsoDelete) {
    if (isTextTarget(e.target)) return;
    const fragment = commands.fragmentFromSelection();
    if (!fragment) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', serializeDoc(fragment));
    if (alsoDelete) commands.deleteSelection();
  }

  function onPaste(e) {
    if (isTextTarget(e.target)) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text?.trim()) return;
    e.preventDefault();
    commands.insertFragment(text);
  }

  const copyHandler = (e) => onCopy(e, false);
  const cutHandler = (e) => onCopy(e, true);

  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('copy', copyHandler);
  document.addEventListener('cut', cutHandler);
  document.addEventListener('paste', onPaste);

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('copy', copyHandler);
      document.removeEventListener('cut', cutHandler);
      document.removeEventListener('paste', onPaste);
    },
  };
}
