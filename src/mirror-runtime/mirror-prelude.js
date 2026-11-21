(() => {
  if (self.__SITE_REA_MIRROR__) return;
  const CFG = self.__REA_CFG__ || {};
  self.__SITE_REA_MIRROR__ = { origin: CFG.origin, pageUrl: CFG.pageUrl, ready: true };
  try { sessionStorage.removeItem("__rea_boot"); } catch {}

  const log = (kind, detail) => {
    try {
      fetch("/__rea__/log", { method: "POST", body: JSON.stringify({ kind, detail }), keepalive: true }).catch(() => {});
    } catch {}
  };

  // The recorded site may register its own service worker at the same scope,
  // which would evict the mirror worker and send every request to the live site.
  if (navigator.serviceWorker) {
    const sw = navigator.serviceWorker;
    const current = () => sw.getRegistration("/").then((r) => r || sw.ready);
    try {
      sw.register = () => current();
      if (self.ServiceWorkerRegistration) {
        ServiceWorkerRegistration.prototype.unregister = () => Promise.resolve(false);
        ServiceWorkerRegistration.prototype.update = function () { return Promise.resolve(this); };
      }
    } catch {}
  }

  // Live sockets cannot be replayed from a recording. A socket that fails to
  // connect is what the page would see offline; it must not reach the origin.
  if (self.WebSocket) {
    class MirrorWebSocket extends EventTarget {
      constructor(url) {
        super();
        this.url = String(url);
        this.readyState = 0;
        this.bufferedAmount = 0;
        this.extensions = "";
        this.protocol = "";
        this.binaryType = "blob";
        this.onopen = this.onmessage = this.onerror = this.onclose = null;
        log("websocket-blocked", this.url);
        setTimeout(() => {
          this.readyState = 3;
          const err = new Event("error");
          this.dispatchEvent(err);
          if (typeof this.onerror === "function") this.onerror(err);
          const close = new CloseEvent("close", { code: 1006, reason: "site-rea offline mirror", wasClean: false });
          this.dispatchEvent(close);
          if (typeof this.onclose === "function") this.onclose(close);
        }, 0);
      }
      send() {}
      close() { this.readyState = 3; }
    }
    MirrorWebSocket.CONNECTING = 0;
    MirrorWebSocket.OPEN = 1;
    MirrorWebSocket.CLOSING = 2;
    MirrorWebSocket.CLOSED = 3;
    self.WebSocket = MirrorWebSocket;
  }

  // Absolute links back to the original origin would leave the mirror.
  if (CFG.origin && self.document) {
    document.addEventListener(
      "click",
      (ev) => {
        if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        const a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
        if (!a || (a.target && a.target !== "_self")) return;
        let u;
        try { u = new URL(a.href); } catch { return; }
        if (u.origin !== CFG.origin) return;
        ev.preventDefault();
        location.assign(u.pathname + u.search + u.hash);
      },
      false
    );
  }
})();
