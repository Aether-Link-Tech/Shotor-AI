import { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { PDFJS_MAIN, PDFJS_WORKER } from '../lib/docs/pdfjs.generated';

/**
 * A hidden WebView that runs pdf.js (bundled in the app, no network) to pull text out of PDFs.
 * Mounted once at the app root; call `extractPdfText(base64)` from anywhere.
 */

type Pending = { resolve: (t: string) => void; reject: (e: Error) => void; onProgress?: (page: number, total: number) => void };
let webview: WebView | null = null;
let ready = false;
let readyWaiters: (() => void)[] = [];
const pending = new Map<string, Pending>();
let seq = 0;

export function extractPdfText(base64: string, onProgress?: (page: number, total: number) => void): Promise<string> {
  const id = String(++seq);
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    const send = () => webview?.injectJavaScript(`window.__extract(${JSON.stringify(id)}, ${JSON.stringify(base64)}); true;`);
    if (ready) send();
    else readyWaiters.push(send);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Reading the PDF timed out.'));
      }
    }, 120000);
  });
}

const HTML = (main: string, worker: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script type="text/plain" id="pdfmain">${main}</script>
<script type="text/plain" id="pdfworker">${worker}</script>
<script type="module">
  const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
  const blobUrl = (id) => URL.createObjectURL(new Blob([document.getElementById(id).textContent], { type: 'text/javascript' }));
  try {
    const pdfjs = await import(blobUrl('pdfmain'));
    pdfjs.GlobalWorkerOptions.workerSrc = blobUrl('pdfworker');
    window.__extract = async (id, b64) => {
      try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
        const pages = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const content = await page.getTextContent();
          let line = '', out = [], lastY = null;
          for (const item of content.items) {
            if (!('str' in item)) continue;
            const y = item.transform ? Math.round(item.transform[5]) : null;
            if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ''; }
            line += item.str + (item.hasEOL ? '\\n' : '');
            lastY = y;
          }
          out.push(line);
          pages.push(out.join('\\n'));
          post({ id, progress: p, total: doc.numPages });
        }
        await doc.destroy();
        post({ id, text: pages.join('\\n\\n') });
      } catch (e) {
        post({ id, error: (e && e.name === 'PasswordException') ? 'This PDF is password-protected.' : String(e && e.message || e) });
      }
    };
    post({ ready: true });
  } catch (e) {
    post({ fatal: String(e && e.message || e) });
  }
</script></body></html>`;

export function PdfHost() {
  const ref = useRef<WebView>(null);
  const html = useMemo(() => HTML(PDFJS_MAIN, PDFJS_WORKER), []);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { id?: string; ready?: boolean; fatal?: string; text?: string; error?: string; progress?: number; total?: number };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.ready) {
      webview = ref.current;
      ready = true;
      const w = readyWaiters;
      readyWaiters = [];
      w.forEach((fn) => fn());
      return;
    }
    if (msg.fatal) {
      pending.forEach((p) => p.reject(new Error('PDF reader failed to start: ' + msg.fatal)));
      pending.clear();
      return;
    }
    const p = msg.id ? pending.get(msg.id) : undefined;
    if (!p) return;
    if (msg.progress && msg.total) return p.onProgress?.(msg.progress, msg.total);
    pending.delete(msg.id!);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.text ?? '');
  };

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={(r) => {
          (ref as React.MutableRefObject<WebView | null>).current = r;
          webview = r;
        }}
        source={{ html, baseUrl: 'https://shotor.local/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        // Never load anything from the network.
        onShouldStartLoadWithRequest={(req) => req.url.startsWith('https://shotor.local') || req.url.startsWith('about:') || req.url.startsWith('blob:')}
        cacheEnabled={false}
        incognito
      />
    </View>
  );
}

const styles = StyleSheet.create({ hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 } });
