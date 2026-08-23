/* LAN Share wording.

   The panel used to explain the transport; it now just tells you what to do.
   Kept as its own hot module so the copy can be corrected on live instances,
   and so it can put the text back if lan-share.js rewrites the status line. */
(function lanCopy() {
  const NAME = "lan-copy";
  window.__hotTeardown?.(NAME);

  const disposers = [];
  const $ = (id) => document.getElementById(id);

  const NOTE = "Share your photos, videos and music with another device on the same Wi-Fi.";
  // Short status lines lan-share.js writes once the link is live. They are
  // allowed to stand; anything else (the old paragraph, on instances still
  // running the previous lan-share.js) gets replaced.
  const KEEP = [
    "On. Anything you add shows up on the other device too.",
    "On, but this device cannot find the others by itself. Use \u201cNo Wi-Fi?\u201d below to pair them by hand.",
  ];
  const STEPS = [
    "Open this page on the other device, on the same Wi-Fi.",
    "Tap LAN Share on both devices.",
    "Wait for the green “on” label. Everything you add now shows up on both.",
  ];
  const OFFLINE_STEPS = [
    "On this device, tap Make invite and copy the code that appears.",
    "Paste it in the box on the other device and tap Use / answer code.",
    "Copy the reply it gives you, paste it back in the box here, and tap Use / answer code.",
  ];

  const setText = (el, text) => {
    if (el && el.textContent !== text) el.textContent = text;
  };
  const setNode = (node, text) => {
    if (node && node.nodeValue !== text) node.nodeValue = text;
  };

  function list(id, items, cls) {
    const ol = document.createElement("ol");
    ol.id = id;
    ol.className = cls;
    items.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      ol.appendChild(li);
    });
    return ol;
  }

  function apply() {
    const note = $("lan-note");
    if (note && note.textContent !== NOTE && !KEEP.includes(note.textContent)) {
      note.textContent = NOTE;
    }

    const panel = $("lan-panel");
    if (!panel) return;

    if (!$("lan-steps")) {
      panel.insertBefore(list("lan-steps", STEPS, "lan-steps"), panel.firstChild);
    }

    const passLabel = $("lan-pass")?.closest("label");
    if (passLabel) {
      const small = passLabel.querySelector("small");
      setNode(passLabel.childNodes[0], "Password ");
      if (small) setText(small, "optional · type the same word on both devices");
    }
    const pass = $("lan-pass");
    if (pass && pass.placeholder !== "leave empty to pair automatically") {
      pass.placeholder = "leave empty to pair automatically";
    }

    const modeLabel = $("lan-receive-mode")?.closest("label");
    if (modeLabel) setNode(modeLabel.childNodes[0], "Files sent to you ");
    const mode = $("lan-receive-mode");
    if (mode) {
      const mirror = mode.querySelector('option[value="mirror"]');
      const save = mode.querySelector('option[value="save"]');
      if (mirror) setText(mirror, "Show them only — nothing is kept");
      if (save) setText(save, "Keep them on this device");
    }

    const offline = panel.querySelector(".lan-offline");
    if (offline) {
      const summary = offline.querySelector("summary");
      if (summary) setText(summary, "No Wi-Fi? Pair the two devices by hand");
      offline.querySelector(".lan-hint:not(#lan-code-out)")?.remove();
      if (!$("lan-offline-steps")) {
        offline.insertBefore(
          list("lan-offline-steps", OFFLINE_STEPS, "lan-steps"),
          offline.querySelector(".row") || null,
        );
      }
      const code = $("lan-code");
      if (code && code.placeholder !== "paste the code here") code.placeholder = "paste the code here";
    }
  }

  apply();

  // lan-share.js repaints #lan-note when the link goes live; put the plain
  // wording back whenever it does.
  const target = $("lan-note")?.parentElement;
  if (target) {
    const watch = { childList: true, characterData: true, subtree: true };
    const mo = new MutationObserver(() => {
      // Pause while re-applying: the fix-up writes into the very subtree the
      // observer is watching.
      mo.disconnect();
      apply();
      mo.observe(target, watch);
    });
    mo.observe(target, watch);
    disposers.push(() => mo.disconnect());
  }

  window.__hotRegister?.(NAME, () => {
    disposers.forEach((fn) => {
      try {
        fn();
      } catch {
        /* nothing to undo */
      }
    });
  });
})();
