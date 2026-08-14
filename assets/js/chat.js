/**
 * Eden chat widget.
 *
 * Two things matter in this file, and neither is the UI:
 *
 * 1. It holds no secret. The API key lives in the Cloudflare worker. This file
 *    is public, like every other file on a static site.
 *
 * 2. Model output is never HTML. Every character the model produces is inserted
 *    with textContent, and links are added afterwards only for an exact-match
 *    list of Eden's own contact details. The threat is not really the model —
 *    it is that model output is attacker-influenced: a visitor can type
 *    anything, and if what they type can steer what gets rendered as HTML, the
 *    page has an injection hole. A whitelist removes the class of bug instead
 *    of filtering for known-bad.
 */
(function () {
  "use strict";

  // Where to send the conversation. Local development talks to the dev server
  // on the same origin; anything else talks to the deployed worker. Without
  // this, running the site locally silently posts to production - which is how
  // the first widget test "passed" by rendering the error fallback.
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var ENDPOINT =
    window.EDEN_CHAT_ENDPOINT ||
    (LOCAL ? "/chat" : "https://eden-chat.andrekorte1979.workers.dev/chat");

  /** All visible strings in one place so they can be reviewed and translated. */
  var TEXT = {
    launcher: "แชท",                       // "Chat" - one word, instantly parsed
    title: "ผู้ช่วยตอบคำถาม",               // "Enquiry assistant"
    subtitle: "ตอบอัตโนมัติ · ทีมงานจริงอยู่ที่ LINE",  // "Automated · the real team is on LINE"
    greeting:
      "สวัสดีค่ะ ถามเรื่องเรียนต่อออสเตรเลียได้เลย " +
      "หากเป็นเรื่องวีซ่าเฉพาะบุคคล ทีมงานจะดูแลต่อทาง LINE นะคะ",
      // "Hello — ask about studying in Australia. Personal visa questions are
      //  handled by the team on LINE."
    placeholder: "พิมพ์คำถามของคุณ...",      // "Type your question…"
    send: "ส่ง",                            // "Send"
    close: "ปิด",                           // "Close"
    thinking: "กำลังพิมพ์...",               // "Typing…"
    error: "ขออภัย ระบบขัดข้องชั่วคราว ทัก LINE @edenstudentservice ได้เลยค่ะ",
      // "Sorry, temporarily unavailable — message LINE @edenstudentservice."
    disclaimer: "ผู้ช่วยอัตโนมัติ ไม่ใช่คำแนะนำด้านวีซ่า",
      // "Automated assistant. Not visa advice." — rule 12, always visible.
  };

  /** The ONLY things that may become links in model output. */
  var LINKIFY = [
    { match: "@edenstudentservice", href: "https://line.me/R/ti/p/@edenstudentservice" },
    { match: "info@eden-studentservice.com", href: "mailto:info@eden-studentservice.com" },
    { match: "sydney@eden-studentservice.com", href: "mailto:sydney@eden-studentservice.com" },
    { match: "ayutthaya@eden-studentservice.com", href: "mailto:ayutthaya@eden-studentservice.com" },
    { match: "bangkok@eden-studentservice.com", href: "mailto:bangkok@eden-studentservice.com" },
  ];

  var messages = [];   // the conversation, sent to the worker each turn
  var busy = false;
  var el = {};

  // ----------------------------------------------------------------- helpers

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  /**
   * Strip markdown tokens from model output before display.
   *
   * The system rules already forbid markdown, but a rule in a prompt is a
   * request, not a guarantee - production showed "**In Australia:**" rendered
   * as literal asterisks on a question no eval case asked. Where a policy can
   * be enforced mechanically, enforce it mechanically and keep the prompt rule
   * as the first line rather than the only one. This runs on every re-render
   * of the accumulating stream, so a "**" split across two chunks still gets
   * caught once both halves have arrived.
   */
  function stripMarkdown(text) {
    return text
      .replace(/\*\*/g, "")          // bold markers
      .replace(/__/g, "")            // the underscore spelling
      .replace(/^#{1,6}\s+/gm, "")   // heading markers at line start
      .replace(/#{2,6}\s?/g, "")     // and stray ## anywhere - a model does not always start a line
      .replace(/^(\s*)\*\s+/gm, "$1- "); // * bullets -> the approved "- " form
  }

  /**
   * Insert plain text into a node, turning ONLY whitelisted contact details
   * into links. Everything else stays inert text. No innerHTML anywhere.
   */
  function renderText(node, text) {
    node.textContent = "";
    var remaining = stripMarkdown(text);

    while (remaining.length) {
      // Find the earliest whitelisted match in what is left.
      var best = null;
      for (var i = 0; i < LINKIFY.length; i++) {
        var at = remaining.indexOf(LINKIFY[i].match);
        if (at !== -1 && (best === null || at < best.at)) {
          best = { at: at, entry: LINKIFY[i] };
        }
      }
      if (!best) {
        node.appendChild(document.createTextNode(remaining));
        return;
      }
      if (best.at > 0) {
        node.appendChild(document.createTextNode(remaining.slice(0, best.at)));
      }
      var a = make("a", null, best.entry.match);
      a.href = best.entry.href;
      a.target = "_blank";
      a.rel = "noopener";
      node.appendChild(a);
      remaining = remaining.slice(best.at + best.entry.match.length);
    }
  }

  function addBubble(role, text) {
    var wrap = make("div", "eden-chat__msg eden-chat__msg--" + role);
    var body = make("div", "eden-chat__bubble");
    renderText(body, text || "");
    wrap.appendChild(body);
    el.log.appendChild(wrap);
    el.log.scrollTop = el.log.scrollHeight;
    return body;
  }

  // ----------------------------------------------------------------- network

  async function send(question) {
    if (busy || !question.trim()) return;
    busy = true;
    el.send.disabled = true;
    el.input.value = "";

    addBubble("user", question);
    messages.push({ role: "user", content: question });

    var bubble = addBubble("bot", TEXT.thinking);
    var answer = "";

    try {
      var res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messages }),
      });
      if (!res.ok || !res.body) throw new Error("HTTP " + res.status);

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        var lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.indexOf("data:") !== 0) continue;
          var event;
          try {
            event = JSON.parse(line.slice(5));
          } catch (e) {
            continue;
          }
          if (event.type === "text") {
            answer += event.text;
            renderText(bubble, answer);
            el.log.scrollTop = el.log.scrollHeight;
          } else if (event.type === "error") {
            throw new Error(event.message || "stream error");
          }
        }
      }

      if (!answer) throw new Error("empty reply");
      messages.push({ role: "assistant", content: answer });
    } catch (err) {
      // The fallback is always a route to a human, never a dead end.
      renderText(bubble, TEXT.error);
      messages.pop();
    } finally {
      busy = false;
      el.send.disabled = false;
      el.input.focus();
    }
  }

  // ----------------------------------------------------------------- build UI

  function build() {
    var root = make("div", "eden-chat");

    el.launcher = make("button", "eden-chat__launcher");
    el.launcher.type = "button";
    el.launcher.setAttribute("aria-expanded", "false");
    el.launcher.setAttribute("aria-label", TEXT.launcher);
    el.launcher.title = TEXT.launcher;
    // A speech-bubble icon, built with DOM calls like everything else here.
    var svgNS = "http://www.w3.org/2000/svg";
    var icon = document.createElementNS(svgNS, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(svgNS, "path");
    path.setAttribute(
      "d",
      "M12 3C6.5 3 2 6.9 2 11.7c0 2.8 1.6 5.3 4 6.9V22l3.6-2c.8.2 1.6.3 2.4.3 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"
    );
    icon.appendChild(path);
    el.launcher.appendChild(icon);
    el.launcher.appendChild(make("span", null, TEXT.launcher));

    var panel = make("div", "eden-chat__panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", TEXT.title);
    panel.hidden = true;
    el.panel = panel;

    var head = make("div", "eden-chat__head");
    var heading = make("div", "eden-chat__heading");
    heading.appendChild(make("strong", null, TEXT.title));
    heading.appendChild(make("small", null, TEXT.subtitle));
    var close = make("button", "eden-chat__close");
    close.type = "button";
    close.setAttribute("aria-label", TEXT.close);
    close.textContent = "×";
    head.appendChild(heading);
    head.appendChild(close);

    el.log = make("div", "eden-chat__log");
    el.log.setAttribute("aria-live", "polite");

    var form = make("form", "eden-chat__form");
    el.input = make("input", "eden-chat__input");
    el.input.type = "text";
    el.input.placeholder = TEXT.placeholder;
    el.input.maxLength = 1000;   // mirrors the worker's cap
    el.input.setAttribute("aria-label", TEXT.placeholder);
    el.send = make("button", "eden-chat__send", TEXT.send);
    el.send.type = "submit";
    form.appendChild(el.input);
    form.appendChild(el.send);

    var note = make("p", "eden-chat__note", TEXT.disclaimer);

    panel.appendChild(head);
    panel.appendChild(el.log);
    panel.appendChild(form);
    panel.appendChild(note);
    root.appendChild(panel);
    root.appendChild(el.launcher);
    document.body.appendChild(root);

    function toggle(open) {
      panel.hidden = !open;
      el.launcher.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        if (!el.log.childNodes.length) addBubble("bot", TEXT.greeting);
        el.input.focus();
      }
    }

    el.launcher.addEventListener("click", function () { toggle(panel.hidden); });
    close.addEventListener("click", function () { toggle(false); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      send(el.input.value);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) toggle(false);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
