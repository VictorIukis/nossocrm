/* eslint-disable no-restricted-globals */
/**
 * Service worker do CRM: acelera a abertura guardando a casca do app.
 *
 * Guardar dado nao e trabalho dele. A versao anterior interceptava TODO GET,
 * inclusive as chamadas ao Supabase, e escrevia as respostas no Cache Storage
 * do navegador. Isso trouxe tres problemas de uma vez:
 *
 *  1. Vazamento. Contatos, negocios, perfis e organization_settings (que guarda
 *     a chave de IA) ficavam gravados em claro no disco do navegador, e
 *     sobreviviam ao logout. Em maquina compartilhada, a proxima pessoa a abrir
 *     o navegador tinha acesso.
 *  2. Erro fantasma. Respostas de erro tambem entravam no cache. Um 401 antigo
 *     voltava a ser servido depois, e o app mostrava falha sem que houvesse
 *     chamada nenhuma acontecendo.
 *  3. Dado velho. A estrategia era devolver o cache primeiro; a tela podia
 *     mostrar dados de uma sessao anterior como se fossem de agora.
 *
 * Agora o worker so toca em recurso estatico do proprio dominio. API, auth e
 * qualquer outra origem passam direto, sem ele no meio.
 */

const CACHE_NAME = 'nossocrm-shell-v3';
// Só entra aqui o que é igual para todo mundo. A raiz ficou de fora de
// propósito: para quem já entrou, ela responde uma tela autenticada, e essa
// tela guardada seria mostrada à próxima pessoa que abrisse o app sem rede.
const SHELL_URLS = [
  '/login',
  '/icons/icon.svg',
  '/icons/maskable.svg',
];

/** Extensoes que sao seguras de guardar: arquivo estatico, nunca dado de gente. */
const ESTATICOS = /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico|webmanifest)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((k) => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k))))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Outra origem (Supabase, fontes, qualquer API): nao e assunto nosso.
  if (url.origin !== self.location.origin) return;

  // Requisicao com credencial ou resposta personalizada nao pode ser guardada,
  // porque o cache e unico e nao distingue quem pediu.
  if (req.headers.has('authorization') || req.headers.has('apikey')) return;

  // Navegacao: rede primeiro, cache so como rede de seguranca quando cai.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // So a casca entra no cache. Pagina de rota autenticada pode conter
          // dado renderizado no servidor.
          if (res.ok && SHELL_URLS.includes(url.pathname)) {
            const copia = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copia)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/login')))
    );
    return;
  }

  // Daqui pra baixo, so arquivo estatico.
  const ehEstatico = ESTATICOS.test(url.pathname) || url.pathname.startsWith('/_next/static/');
  if (!ehEstatico) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const daRede = fetch(req)
        .then((res) => {
          // Guardar so resposta boa. Erro no cache vira erro fantasma depois.
          if (res.ok && res.type === 'basic') {
            const copia = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copia)).catch(() => {});
          }
          return res;
        })
        // Sem cache e sem rede, deixa o erro ser erro: devolver undefined aqui
        // faz o navegador falhar a requisicao de um jeito que nao se explica.
        .catch((e) => cached || Promise.reject(e));
      return cached || daRede;
    })
  );
});
