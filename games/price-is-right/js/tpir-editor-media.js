/* ============================================================
   The Price Is Right — editor photo controls (docs/19 §3)

   The photo control the prize editor puts on every item: paste a URL,
   or Choose file… and have the browser downscale and re-encode it
   into a data: URI, plus alt text, a live thumbnail, a per-image
   size note and the running "Embedded photos: ~N MB" meter.

   The canvas pipeline (opaque-white fill, createImageBitmap with
   EXIF orientation, the blank/striped corrupt-draw detector and the
   decode-smaller retry) is the field-tested one from
   games/jeopardy/js/editor-media.js — the same failures happen on
   the same phones. Every reference goes through window.TpirMedia,
   the SAME gate that validates a loaded file, so the editor can
   never hand Use-in-game a value the game would refuse.
   Browser-only DOM glue; attaches window.TpirEditorMedia.
   ============================================================ */

"use strict";

(function () {
  "use strict";

  const MAX_EMBED_DIM = 1024;                 // longest edge after downscale, px
  const EMBED_QUALITY = 0.75;                 // JPEG quality for the data URI
  const IMG_WARN_BYTES = 2.5 * 1024 * 1024;   // warn above ~2.5 MB embedded

  const HEIC_RE = /\.(heic|heif)$/i;
  const HEIC_MESSAGE = "iPhone HEIC photos aren’t supported by browsers. Set the camera to "
    + "“Most Compatible” (JPEG), screenshot the photo, or paste an image URL instead.";
  const STRIPED_MESSAGE = "That photo came out corrupted — black bands instead of the picture — because this "
    + "device ran out of memory processing it. Try a smaller copy, or paste an image URL instead.";
  const BLANK_MESSAGE = "That photo came out blank — it may be too large for this device to process. Try a "
    + "different or smaller photo, or paste an image URL instead.";

  /* ============ Byte estimation for the meter ============ */

  /** Approximate decoded bytes of a reference; only data: URIs cost storage. */
  function estimateRefBytes(ref) {
    if (typeof ref !== "string" || ref.slice(0, 5).toLowerCase() !== "data:") return 0;
    const comma = ref.indexOf(",");
    if (comma < 0) return 0;
    const meta = ref.slice(0, comma);
    const payload = ref.slice(comma + 1);
    if (/;base64/i.test(meta)) {
      const pad = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
      return Math.max(0, Math.floor((payload.length * 3) / 4) - pad);
    }
    return payload.length;
  }

  /** Every object in a draft that may carry a photo (docs/19 §3). */
  function photoSlots(draft) {
    const out = [];
    if (!draft || typeof draft !== "object") return out;
    const push = (list) => {
      if (Array.isArray(list)) list.forEach((x) => { if (x && typeof x === "object") out.push(x); });
    };
    push(draft.oneBid);
    push(draft.luckyseven);
    if (Array.isArray(draft.cliffhangers)) {
      draft.cliffhangers.forEach((set) => {
        if (!set || typeof set !== "object") return;
        push(set.items);
        if (set.prize && typeof set.prize === "object") out.push(set.prize);
      });
    }
    if (Array.isArray(draft.showcases)) draft.showcases.forEach((sc) => push(sc && sc.prizes));
    return out;
  }

  const totalEmbeddedBytes = (draft) =>
    photoSlots(draft).reduce((sum, item) => sum + estimateRefBytes(item.image), 0);

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  }

  /* ============ Canvas downscale + embed ============ */

  const BLACK_LEVEL = 8;
  const MIN_STRIPE_ROWS = 16;
  const MIN_STRIPE_SHARE = 0.12;
  const MIN_STRIPE_BANDS = 6;

  const looksHeic = (file) => {
    const type = (file && file.type) || "";
    return type === "image/heic" || type === "image/heif" || (!!file && HEIC_RE.test(file.name || ""));
  };

  /**
   * Classify a drawn canvas as "ok", "blank" or "striped". A browser that runs
   * out of memory rasterising a big photo does not throw — it hands back a
   * canvas that is uniform, or banded with pure-black rows. The canvas was
   * pre-filled opaque white, so a pure-black full-width row cannot come from
   * the fill. Fails safe to "ok" if the pixels cannot be read.
   * @returns {"ok"|"blank"|"striped"}
   */
  function classifyDraw(ctx, w, h) {
    let data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (err) { return "ok"; }
    if (data.length < 8) return "ok";
    const r0 = data[0];
    const g0 = data[1];
    const b0 = data[2];
    let uniform = true;
    let blackRows = 0;
    let bands = 0;
    let prevBlack = null;
    for (let y = 0; y < h; y += 1) {
      let rowBlack = true;
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) uniform = false;
        if (data[i] > BLACK_LEVEL || data[i + 1] > BLACK_LEVEL || data[i + 2] > BLACK_LEVEL) rowBlack = false;
      }
      if (rowBlack) blackRows += 1;
      if (prevBlack !== null && rowBlack !== prevBlack) bands += 1;
      prevBlack = rowBlack;
    }
    if (uniform) return "blank";
    if (h >= MIN_STRIPE_ROWS && blackRows / h >= MIN_STRIPE_SHARE && bands >= MIN_STRIPE_BANDS) return "striped";
    return "ok";
  }

  /**
   * Draw a decoded source downscaled onto a canvas and return a JPEG data URI.
   * Paints OPAQUE WHITE first: JPEG has no alpha, so without it every
   * transparent pixel would encode as black.
   * @returns {{dataUrl:string|null, reason:"blank"|"striped"|null}}
   */
  function encodeToJpeg(source, srcW, srcH) {
    const scale = Math.min(1, MAX_EMBED_DIM / (Math.max(srcW, srcH) || 1));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas 2d context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    const verdict = classifyDraw(ctx, w, h);
    if (verdict !== "ok") return { dataUrl: null, reason: verdict };
    return { dataUrl: canvas.toDataURL("image/jpeg", EMBED_QUALITY), reason: null };
  }

  /** FileReader + <img> decode fallback. */
  function decodeViaImageElement(file, finish, fail) {
    const reader = new FileReader();
    reader.onerror = () => fail("Could not read that file.");
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => fail(looksHeic(file) ? HEIC_MESSAGE : "That image could not be decoded.");
      img.onload = () => finish(img, img.naturalWidth, img.naturalHeight, null);
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  /**
   * Encode one decoded source and report the outcome. `onBadDraw(reason, w, h)`
   * — when given — takes over on an unusable frame instead of reporting it, so
   * the caller can try a cheaper decode before giving up.
   */
  function makeFinisher(onDone, fail, failFor) {
    return (source, w, h, close, onBadDraw) => {
      let result = null;
      try {
        result = encodeToJpeg(source, w, h);
      } catch (err) {
        console.warn("Photo embed failed:", err);
        if (close) close();
        fail("Could not embed that photo.");
        return;
      }
      if (close) close();
      if (result.reason) {
        if (onBadDraw) onBadDraw(result.reason, w, h);
        else failFor(result.reason);
        return;
      }
      onDone(result.dataUrl);
    };
  }

  /**
   * Read an image file, downscale it to at most MAX_EMBED_DIM on its long edge
   * and re-encode it as a JPEG data URI. Decodes via `createImageBitmap` when
   * available (memory-efficient for 12–48 MP phone photos, and
   * `imageOrientation:"from-image"` keeps EXIF-rotated photos upright).
   * @param {File} file @param {(d:string)=>void} onDone @param {(m:string)=>void} onError
   */
  function downscaleImageFile(file, onDone, onError) {
    const fail = (m) => { if (onError) onError(m); };
    if (!file || typeof file.type !== "string" || !/^image\//.test(file.type)) {
      fail(looksHeic(file) ? HEIC_MESSAGE : "Please choose an image file.");
      return;
    }
    const failFor = (reason) => fail(reason === "striped" ? STRIPED_MESSAGE : BLANK_MESSAGE);

    const finish = makeFinisher(onDone, fail, failFor);

    const decodeBitmap = (extra) => {
      const options = Object.assign({ imageOrientation: "from-image" }, extra || {});
      try { return createImageBitmap(file, options); } catch (err) { return null; }
    };

    /** The first draw was unusable: ask the BROWSER to downscale during decode. */
    const retrySmaller = (reason, w, h) => {
      if (Math.max(w, h) <= MAX_EMBED_DIM) { failFor(reason); return; }
      const box = w >= h ? { resizeWidth: MAX_EMBED_DIM } : { resizeHeight: MAX_EMBED_DIM };
      box.resizeQuality = "high";
      const retry = decodeBitmap(box);
      if (!retry) { failFor(reason); return; }
      retry.then(
        (small) => finish(small, small.width, small.height, () => { if (small.close) small.close(); }, null),
        () => failFor(reason)
      );
    };

    const bitmapPromise = typeof createImageBitmap === "function" ? decodeBitmap({}) : null;
    if (bitmapPromise) {
      bitmapPromise.then(
        (bmp) => finish(bmp, bmp.width, bmp.height, () => { if (bmp.close) bmp.close(); }, retrySmaller),
        () => decodeViaImageElement(file, finish, fail)
      );
      return;
    }
    decodeViaImageElement(file, finish, fail);
  }

  /* ============ The photo control ============ */

  /** The URL field, the file picker and the alt box for one item. */
  function buildFields(model, refresh, onChange) {
    const row = el("div", "ed-photo-row");
    const url = el("input", "ed-photo-url");
    url.type = "text";
    url.placeholder = "Paste a photo URL, or embed a file";
    url.autocomplete = "off";
    url.spellcheck = false;
    url.setAttribute("aria-label", "Photo URL");
    url.value = typeof model.image === "string" ? model.image : "";
    const file = el("input");
    file.type = "file";
    file.accept = "image/*";
    file.hidden = true;
    const choose = TpirView.button("Choose file…", "btn btn-ghost btn-small", () => file.click());
    row.appendChild(url);
    row.appendChild(choose);
    row.appendChild(file);

    const alt = el("input", "ed-photo-alt");
    alt.type = "text";
    alt.maxLength = 200;
    alt.autocomplete = "off";
    alt.placeholder = "Alt text (screen readers), e.g. A blue mountain bike";
    alt.setAttribute("aria-label", "Photo alt text");
    alt.value = typeof model.imageAlt === "string" ? model.imageAlt : "";

    const setRef = (value) => {
      if (typeof value === "string" && value.trim() !== "") model.image = value;
      else { delete model.image; delete model.imageAlt; }
      url.value = typeof model.image === "string" ? model.image : "";
      refresh();
      onChange();
    };
    url.addEventListener("input", () => setRef(url.value));
    alt.addEventListener("input", () => {
      if (alt.value.trim() !== "") model.imageAlt = alt.value;
      else delete model.imageAlt;
      refresh();
      onChange();
    });
    return { row, alt, file, setRef };
  }

  /**
   * Repaint one control's thumbnail, size note or error from the current model
   * value. The verdict and the <img> both come from window.TpirMedia, the same
   * gate that blocks Use-in-game, so a bad reference always shows a reason.
   */
  function paintFeedback(model, feedback, toggle) {
    feedback.replaceChildren();
    const ref = model.image;
    const has = typeof ref === "string" && ref.trim() !== "";
    toggle.classList.toggle("has-photo", has);
    if (!has) return;
    const res = window.TpirMedia.validateImageRef(ref);
    if (!res.valid) { feedback.appendChild(el("p", "ed-photo-error", res.error)); return; }
    const thumb = window.TpirMedia.buildValidatedImage(ref, model.imageAlt || model.name);
    if (thumb) { thumb.className = "ed-photo-thumb"; feedback.appendChild(thumb); }
    const bytes = estimateRefBytes(ref);
    if (bytes > 0) feedback.appendChild(el("span", "ed-photo-size", `Embedded ~${formatBytes(bytes)}`));
  }

  /**
   * The whole photo control for one prize: a camera toggle, and behind it the
   * URL / file / alt fields with a live thumbnail, size note and inline error.
   * The thumbnail and the error come from window.TpirMedia — the same gate
   * that blocks Use-in-game — so a bad reference shows an error and is never
   * silently kept.
   * @param {{model:object, onChange:()=>void}} opts @returns {HTMLElement}
   */
  function buildImageControl(opts) {
    const { model, onChange } = opts;
    const box = el("div", "ed-photo");
    const feedback = el("div", "ed-photo-feedback");

    const toggle = TpirView.button("📷", "btn btn-ghost btn-small ed-photo-toggle", () => {
      const open = panel.classList.contains("hidden");
      show(panel, open);
      toggle.setAttribute("aria-expanded", String(open));
    });
    toggle.setAttribute("aria-expanded", "false");
    toggle.title = "Photo for this prize";
    toggle.setAttribute("aria-label", "Photo for this prize");

    const refresh = () => paintFeedback(model, feedback, toggle);
    const fields = buildFields(model, refresh, onChange);
    const panel = el("div", "ed-photo-panel hidden");
    panel.appendChild(fields.row);
    panel.appendChild(fields.alt);
    panel.appendChild(feedback);
    panel.appendChild(TpirView.button("Remove photo", "btn btn-ghost btn-small", () => {
      fields.alt.value = "";
      fields.setRef("");
    }));

    fields.file.addEventListener("change", () => {
      const chosen = fields.file.files && fields.file.files[0];
      fields.file.value = "";
      if (!chosen) return;
      feedback.replaceChildren(el("span", "ed-photo-size", "Embedding…"));
      downscaleImageFile(chosen, (dataUrl) => fields.setRef(dataUrl),
        (message) => { feedback.replaceChildren(el("p", "ed-photo-error", message)); });
    });

    box.appendChild(toggle);
    box.appendChild(panel);
    refresh();
    return box;
  }

  /** "Embedded photos: ~N MB", amber and cautionary above the warn threshold. */
  function renderMeter(draft, meterEl) {
    if (!meterEl) return;
    const bytes = totalEmbeddedBytes(draft);
    const over = bytes > IMG_WARN_BYTES;
    meterEl.classList.toggle("warn", over);
    if (bytes === 0) {
      meterEl.textContent = "Embedded photos: none — photo URLs and repo paths cost nothing to save.";
      return;
    }
    meterEl.textContent = over
      ? `Embedded photos: ~${formatBytes(bytes)} — large; auto-save may fail. Prefer photo URLs for big pictures.`
      : `Embedded photos: ~${formatBytes(bytes)}`;
  }

  window.TpirEditorMedia = {
    MAX_EMBED_DIM, EMBED_QUALITY, IMG_WARN_BYTES,
    estimateRefBytes, photoSlots, totalEmbeddedBytes, formatBytes, paintFeedback,
    classifyDraw, downscaleImageFile, buildImageControl, renderMeter,
  };
})();
