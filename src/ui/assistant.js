/**
 * The assistant panel.
 *
 * A floating card over the canvas rather than a third region, because the
 * diagram is the thing being talked about and watching it change is most of the
 * point — a panel that pushed the drawing aside would hide the answer.
 *
 * Built only when the deployment says the assistant is on, so an editor without
 * it has no button, no panel and no dead affordance explaining that a feature
 * is unavailable.
 */

import { h, clear } from '../util/dom.js';

export function createAssistantPanel(root, { assistant, toaster }) {
  let open = false;

  const log = h('div', { class: 'chat-log' });
  const input = h('textarea', {
    class: 'chat-input',
    rows: 2,
    placeholder: 'Ask for a change, or a diagram from scratch…',
    onKeyDown: (e) => {
      // Enter sends, Shift+Enter breaks the line. A chat box that needs a
      // button press is a chat box people stop using.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
      // The canvas listens for single letters as tools; typing "g" into a
      // message must not draw a zone behind the panel.
      e.stopPropagation();
    },
  });

  const sendBtn = h('button', { class: 'btn btn-primary', type: 'button', text: 'Send', onClick: () => submit() });
  const newBtn = h('button', {
    class: 'btn',
    type: 'button',
    title: 'Start a new conversation',
    text: 'New',
    onClick: () => assistant.startNew(),
  });
  const history = h('select', {
    class: 'chat-history',
    title: 'Earlier conversations',
    onChange: (e) => {
      if (e.target.value) assistant.select(e.target.value);
      else assistant.startNew();
    },
  });

  const panel = h('section', { class: 'chat is-hidden', 'aria-label': 'Diagram assistant' }, [
    h('header', { class: 'chat-head' }, [
      h('span', { class: 'chat-title', text: 'Assistant' }),
      history,
      newBtn,
      h('button', {
        class: 'btn btn-icon',
        type: 'button',
        title: 'Close',
        'aria-label': 'Close the assistant',
        text: '✕',
        onClick: () => api.toggle(false),
      }),
    ]),
    log,
    h('div', { class: 'chat-compose' }, [input, sendBtn]),
  ]);
  root.append(panel);

  async function submit() {
    const text = input.value.trim();
    if (!text || assistant.busy) return;
    input.value = '';
    const result = await assistant.ask(text);
    if (!result.ok && result.error) toaster?.error(result.error);
  }

  function render() {
    // Only redraw the transcript when it has actually changed: this is called
    // on every store notification, and rebuilding it under the pointer would
    // break selecting text in an answer.
    const messages = assistant.visible;
    const signature = `${assistant.currentId}:${messages.length}:${assistant.busy}`;
    if (log.dataset.signature !== signature) {
      log.dataset.signature = signature;
      clear(log);
      if (!messages.length) {
        log.append(h('p', { class: 'chat-empty', text:
          'Describe the system and it will draw one, or ask for a change to what is open. ' +
          'It edits the diagram directly, so undo works on whatever it does.' }));
      }
      for (const message of messages) {
        log.append(h('div', { class: `chat-turn is-${message.role}` }, [
          h('span', { class: 'chat-who', text: message.role === 'user' ? 'You' : 'Assistant' }),
          h('p', { class: 'chat-text', text: message.content }),
        ]));
      }
      if (assistant.busy) log.append(h('div', { class: 'chat-turn is-working', text: 'Working…' }));
      log.scrollTop = log.scrollHeight;
    }

    const wanted = assistant.sessions.map((s) => [s.id, s.title]);
    const shown = [...history.options].map((o) => [o.value, o.text]);
    const same = shown.length === wanted.length + 1 &&
      wanted.every(([id], i) => shown[i + 1]?.[0] === id);
    if (!same) {
      clear(history);
      history.append(h('option', { value: '', text: 'New conversation' }));
      for (const [id, title] of wanted) history.append(h('option', { value: id, text: title }));
    }
    history.value = assistant.currentId ?? '';

    sendBtn.disabled = assistant.busy;
    input.disabled = assistant.busy;
  }

  assistant.subscribe(render);
  render();

  const api = {
    toggle(next = !open) {
      open = next;
      panel.classList.toggle('is-hidden', !open);
      if (open) input.focus();
      return open;
    },
    get isOpen() {
      return open;
    },
    render,
  };
  return api;
}
