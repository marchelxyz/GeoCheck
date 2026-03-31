/**
 * Подключается первым в index.js: единый порядок DNS и IPv4-only для fetch (undici),
 * пока не загружены модули с исходящими запросами.
 */
import dns from 'node:dns';
import { Agent, setGlobalDispatcher } from 'undici';

dns.setDefaultResultOrder('ipv4first');
setGlobalDispatcher(
  new Agent({
    // Иначе undici снова включает RFC 8305 и параллельно бьёт в IPv6
    autoSelectFamily: false,
    connect: {
      family: 4,
      timeout: 45_000
    }
  })
);
