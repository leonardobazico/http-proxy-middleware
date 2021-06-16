import type { Options } from './types';
import type * as httpProxy from 'http-proxy';
import { getInstance } from './logger';
import { IncomingMessage, ServerResponse } from 'http';
const logger = getInstance();

export function init(proxy: httpProxy, option: Options): void {
  const handlers = getHandlers(option);

  for (const eventName of Object.keys(handlers)) {
    proxy.on(eventName, handlers[eventName]);
  }

  logger.debug('[HPM] Subscribed to http-proxy events:', Object.keys(handlers));
}

type HttpProxyEventName = 'error' | 'proxyReq' | 'proxyReqWs' | 'proxyRes' | 'open' | 'close';

export function getHandlers(options: Options) {
  // https://github.com/nodejitsu/node-http-proxy#listening-for-proxy-events
  const proxyEventsMap: Record<HttpProxyEventName, string> = {
    error: 'onError',
    proxyReq: 'onProxyReq',
    proxyReqWs: 'onProxyReqWs',
    proxyRes: 'onProxyRes',
    open: 'onOpen',
    close: 'onClose',
  };

  const handlers: any = {};

  for (const [eventName, onEventName] of Object.entries(proxyEventsMap)) {
    // all handlers for the http-proxy events are prefixed with 'on'.
    // loop through options and try to find these handlers
    // and add them to the handlers object for subscription in init().
    const fnHandler = options ? options[onEventName] : null;

    if (typeof fnHandler === 'function') {
      handlers[eventName] = wrapWithErrorHandler(eventName, fnHandler);
    }
  }

  // add default error handler in absence of error handler
  if (typeof handlers.error !== 'function') {
    handlers.error = defaultErrorHandler;
  }

  // add default close handler in absence of close handler
  if (typeof handlers.close !== 'function') {
    handlers.close = logClose;
  }

  return handlers;
}

function wrapWithErrorHandler(eventName: string, handler) {
  if (eventName !== 'proxyReq') {
    return handler;
  }

  return function (proxy, req, res, ...args) {
    try {
      return handler(proxy, req, res, ...args);
    } catch (exception) {
      proxy.destroy(exception);
    }
  };
}

function defaultErrorHandler(err, req: IncomingMessage, res: ServerResponse) {
  // Re-throw error. Not recoverable since req & res are empty.
  if (!req && !res) {
    throw err; // "Error: Must provide a proper URL as target"
  }

  const host = req.headers && req.headers.host;
  const code = err.code;

  if (res.writeHead && !res.headersSent) {
    res.writeHead(getErrorCode(code));
  }

  res.end(`Error occured while trying to proxy: ${host}${req.url}`);
}

function getErrorCode(code: string): number {
  if (/HPE_INVALID/.test(code)) {
    return 502;
  }

  switch (code) {
    case 'ECONNRESET':
    case 'ENOTFOUND':
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
      return 504;
    default:
      return 500;
  }
}

function logClose(req, socket, head) {
  // view disconnected websocket connections
  logger.info('[HPM] Client disconnected');
}
