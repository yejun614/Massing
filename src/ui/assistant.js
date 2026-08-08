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

import { h, clear, setClass } from '../util/dom.js';

/**
 * A question, and what was selected when it was asked.
 *
 * The two travel as one string so a conversation reopened tomorrow still says
 * why the answer was about those particular blocks. They are shown apart,
 * because only the first half is what anybody typed.
 */
function splitAttachment(content) {
  const at = String(content ?? '').indexOf('\n\n[Selected in the editor: ');
  if (at < 0) return [content, null];
  return [
    content.slice(0, at),
    content.slice(at).replace(/^\s*\[Selected in the editor: /, '').replace(/\]\s*$/, ''),
  ];
}

export function createAssistantPanel(root, { assistant, store, toaster, onToggle }) {
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
  const contextLabel = h('span', { class: 'chat-context-label' });
  const context = h('div', { class: 'chat-context is-hidden' }, [
    contextLabel,
    h('button', {
      class: 'chat-context-drop',
      type: 'button',
      title: 'Ask without the selection',
      'aria-label': 'Ask without the selection',
      text: '✕',
      onClick: () => {
        attachSelection = false;
        render();
        input.focus();
      },
    }),
  ]);
  const newBtn = h('button', {
    class: 'btn',
    type: 'button',
    title: 'Start a new conversation',
    text: 'New',
    onClick: () => assistant.startNew(),
  });
  /*
   * The conversation list, as a real menu rather than a `<select>`.
   *
   * A native option list is drawn by the operating system and cannot be styled
   * at all, which in a panel like this shows up as a grey OS rectangle over a
   * themed card. It also has no room for anything but a label — and the one
   * thing a list of saved conversations needs beyond its labels is a way to
   * throw one away.
   */
  const pickerLabel = h('span', { class: 'chat-picker-label' });
  const picker = h('button', {
    class: 'chat-picker',
    type: 'button',
    title: 'Earlier conversations',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    onClick: (e) => {
      e.stopPropagation();
      showMenu(!menuOpen);
    },
  }, [pickerLabel, h('span', { class: 'chat-picker-arrow', 'aria-hidden': 'true', text: '▾' })]);

  const menu = h('div', { class: 'chat-menu is-hidden', role: 'listbox' });
  const picked = h('div', { class: 'chat-picker-wrap' }, [picker, menu]);

  let menuOpen = false;
  let lastSelection = '';

  /** Close on anything that is not this menu: a click elsewhere, or Escape. */
  const onOutside = (e) => {
    if (!picked.contains(e.target)) showMenu(false);
  };
  const onEscape = (e) => {
    if (e.key === 'Escape') {
      showMenu(false);
      picker.focus();
    }
  };

  function showMenu(next) {
    menuOpen = next;
    menu.classList.toggle('is-hidden', !menuOpen);
    picker.setAttribute('aria-expanded', String(menuOpen));
    setClass(picker, 'is-open', menuOpen);
    // Listeners only while it is open, so a closed menu costs nothing and
    // cannot answer for a click meant for something else.
    const method = menuOpen ? 'addEventListener' : 'removeEventListener';
    document[method]('pointerdown', onOutside);
    document[method]('keydown', onEscape, true);
    if (menuOpen) buildMenu();
  }

  function buildMenu() {
    clear(menu);
    menu.append(
      h('button', {
        class: `chat-menu-item is-new${assistant.currentId ? '' : ' is-current'}`,
        type: 'button',
        role: 'option',
        'aria-selected': String(!assistant.currentId),
        text: 'New conversation',
        onClick: () => {
          assistant.startNew();
          showMenu(false);
          input.focus();
        },
      })
    );
    if (!assistant.sessions.length) {
      menu.append(h('p', { class: 'chat-menu-empty', text: 'Nothing saved yet.' }));
      return;
    }
    for (const session of assistant.sessions) {
      const current = session.id === assistant.currentId;
      menu.append(
        h('div', { class: `chat-menu-row${current ? ' is-current' : ''}` }, [
          h('button', {
            class: 'chat-menu-item',
            type: 'button',
            role: 'option',
            'aria-selected': String(current),
            title: session.title,
            text: session.title,
            onClick: () => {
              assistant.select(session.id);
              showMenu(false);
            },
          }),
          h('button', {
            class: 'chat-menu-drop',
            type: 'button',
            title: `Delete "${session.title}"`,
            'aria-label': `Delete "${session.title}"`,
            text: '✕',
            onClick: (e) => {
              // Without this the row behind it would also fire and select the
              // conversation being deleted.
              e.stopPropagation();
              assistant.remove(session.id);
              buildMenu();
            },
          }),
        ])
      );
    }
  }

  const panel = h('section', { class: 'chat is-hidden', 'aria-label': 'Diagram assistant' }, [
    h('header', { class: 'chat-head' }, [
      h('span', { class: 'chat-title', text: 'Assistant' }),
      picked,
      newBtn,
      h('button', {
        class: 'btn btn-icon',
        type: 'button',
        title: 'Close',
        'aria-label': 'Close the assistant',
        text: '✕',
        // The menu is a child of the panel, so closing one has to close the
        // other or it is left listening for clicks on a hidden card.
        onClick: () => {
          showMenu(false);
          api.toggle(false);
        },
      }),
    ]),
    log,
    context,
    h('div', { class: 'chat-compose' }, [input, sendBtn]),
  ]);
  root.append(panel);

  /*
   * What is selected travels with the question.
   *
   * "Make these blue" is unanswerable without it, and asking the model to fetch
   * the selection would put a round trip between the question and the answer.
   * Detachable, because sometimes what is selected is simply what was last
   * clicked and has nothing to do with what is being asked.
   */
  let attachSelection = true;

  async function submit() {
    const text = input.value.trim();
    if (!text || assistant.busy) return;
    const selection = attachSelection ? store?.state.selection ?? [] : [];
    input.value = '';
    const result = await assistant.ask(text, { selection });
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
        // The selection travelled inside the question, which is right for the
        // record and wrong for the bubble: it is not what the person typed.
        const [said, attached] = splitAttachment(message.content);
        log.append(h('div', { class: `chat-turn is-${message.role}` }, [
          h('span', { class: 'chat-who', text: message.role === 'user' ? 'You' : 'Assistant' }),
          h('p', { class: 'chat-text', text: said }),
          ...(attached ? [h('span', { class: 'chat-attached', text: `with ${attached}` })] : []),
        ]));
      }
      if (assistant.busy) log.append(h('div', { class: 'chat-turn is-working', text: 'Working…' }));
      log.scrollTop = log.scrollHeight;
    }

    const session = assistant.sessions.find((s) => s.id === assistant.currentId);
    pickerLabel.textContent = session?.title ?? 'New conversation';
    setClass(picker, 'is-empty', !session);
    // Rebuilt in place while it is open, so deleting the conversation being
    // shown does not leave a stale list behind.
    if (menuOpen) buildMenu();

    const selection = store?.state.selection ?? [];
    // Re-arms itself whenever the selection changes: detaching applies to the
    // thing that was selected then, not to everything selected afterwards.
    if (selection.join() !== lastSelection) {
      lastSelection = selection.join();
      attachSelection = true;
    }
    const showing = attachSelection && selection.length > 0;
    context.classList.toggle('is-hidden', !showing);
    if (showing) {
      contextLabel.textContent =
        `${selection.length} selected — sent with your message`;
    }

    sendBtn.disabled = assistant.busy;
    input.disabled = assistant.busy;
    panel.classList.toggle('is-working', assistant.busy);
  }

  assistant.subscribe(render);
  render();

  const api = {
    toggle(next = !open) {
      open = next;
      panel.classList.toggle('is-hidden', !open);
      if (open) input.focus();
      // Announced rather than returned, because the close button and the escape
      // key reach this too and neither has a caller to return to.
      onToggle?.(open);
      return open;
    },
    get isOpen() {
      return open;
    },
    render,
  };
  return api;
}
