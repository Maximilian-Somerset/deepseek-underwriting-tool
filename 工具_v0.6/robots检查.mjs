/**
 * robots.txt 检查 - v0.6
 * 遵守网站爬虫规范
 */

import { HTTP } from './配置常量.mjs';
import { logger } from './日志工具.mjs';

/**
 * robots.txt 缓存
 * @type {Map<string, {allowed: boolean, cached: number}>}
 */
const robotsCache = new Map();

/**
 * 缓存有效期（毫秒）
 */
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时

/**
 * 解析robots.txt内容
 * @param {string} content robots.txt内容
 * @param {string} userAgent 用户代理
 * @returns {{disallowed: string[], allowed: string[]}}
 */
function parseRobotsTxt(content, userAgent = '*') {
  const lines = content.split('\n').map(line => line.trim());
  const disallowed = [];
  const allowed = [];
  let currentAgent = null;
  let matchesAgent = false;

  for (const line of lines) {
    // 跳过注释和空行
    if (line.startsWith('#') || line === '') continue;

    if (line.toLowerCase().startsWith('user-agent:')) {
      const agent = line.substring(11).trim().toLowerCase();
      currentAgent = agent;
      matchesAgent = agent === '*' || userAgent.toLowerCase().includes(agent);
    } else if (matchesAgent) {
      if (line.toLowerCase().startsWith('disallow:')) {
        const path = line.substring(9).trim();
        if (path) disallowed.push(path);
      } else if (line.toLowerCase().startsWith('allow:')) {
        const path = line.substring(6).trim();
        if (path) allowed.push(path);
      }
    }
  }

  return { disallowed, allowed };
}

/**
 * 检查路径是否匹配规则
 * @param {string} path URL路径
 * @param {string} pattern robots.txt规则
 * @returns {boolean}
 */
function matchesPattern(path, pattern) {
  // 简单的通配符匹配
  if (pattern === '/') return true;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return path.startsWith(prefix);
  }
  return path.startsWith(pattern);
}

/**
 * 检查URL是否允许爬取
 * @param {string} url 完整URL
 * @param {string} [userAgent] 用户代理
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkRobotsPermission(url, userAgent = HTTP.USER_AGENT) {
  try {
    const urlObj = new URL(url);
    const origin = urlObj.origin;
    const pathname = urlObj.pathname;

    // 检查缓存
    const cacheKey = `${origin}:${userAgent}`;
    const cached = robotsCache.get(cacheKey);
    if (cached && Date.now() - cached.cached < CACHE_TTL) {
      logger.debug(`robots.txt缓存命中：${origin}`);
      return { allowed: cached.allowed };
    }

    // 获取robots.txt
    const robotsUrl = `${origin}/robots.txt`;
    logger.debug(`获取robots.txt：${robotsUrl}`);

    const response = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': userAgent }
    });

    if (!response.ok) {
      // robots.txt不存在或无法访问，默认允许
      if (response.status === 404 || response.status === 403) {
        logger.debug(`robots.txt不存在（${response.status}），默认允许`);
        robotsCache.set(cacheKey, { allowed: true, cached: Date.now() });
        return { allowed: true };
      }
    }

    const content = await response.text();
    const rules = parseRobotsTxt(content, userAgent);

    // 检查Allow规则（优先级更高）
    for (const pattern of rules.allowed) {
      if (matchesPattern(pathname, pattern)) {
        logger.debug(`匹配Allow规则：${pattern}`);
        robotsCache.set(cacheKey, { allowed: true, cached: Date.now() });
        return { allowed: true };
      }
    }

    // 检查Disallow规则
    for (const pattern of rules.disallowed) {
      if (matchesPattern(pathname, pattern)) {
        logger.warn(`匹配Disallow规则：${pattern}，拒绝爬取${url}`);
        robotsCache.set(cacheKey, { allowed: false, cached: Date.now() });
        return { allowed: false, reason: `robots.txt禁止：${pattern}` };
      }
    }

    // 没有匹配任何规则，默认允许
    robotsCache.set(cacheKey, { allowed: true, cached: Date.now() });
    return { allowed: true };

  } catch (error) {
    // robots.txt检查失败，默认允许（避免误伤）
    logger.warn(`robots.txt检查失败：${error.message}，默认允许`);
    return { allowed: true };
  }
}

/**
 * 清除robots.txt缓存
 */
export function clearRobotsCache() {
  robotsCache.clear();
  logger.info('已清除robots.txt缓存');
}
