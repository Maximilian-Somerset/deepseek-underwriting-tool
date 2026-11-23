/**
 * 联网接口 - v0.6
 * 改进版：使用错误处理模块，增加robots.txt检查
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import { HTTP, ERROR_CODE, VALIDATION } from './配置常量.mjs';
import { ServiceError, UnderwritingError, parseHttpStatus } from './错误处理.mjs';
import { logger } from './日志工具.mjs';
import { checkRobotsPermission } from './robots检查.mjs';

/**
 * 发送JSON POST请求
 * @param {string} url
 * @param {string} key API密钥
 * @param {object} body 请求体
 * @param {string} service 服务名称
 * @param {typeof fetch} [fetcher]
 * @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
export async function postJson(url, key, body, service, fetcher = fetch, timeoutMs = HTTP.DEFAULT_TIMEOUT) {
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error'
    });
  } catch (error) {
    logger.debug(`${service}网络请求失败：${error.message}`);
    throw new ServiceError(service, ERROR_CODE.NETWORK_TIMEOUT);
  }

  if (!response.ok) {
    const code = parseHttpStatus(response.status);
    logger.warn(`${service}返回错误：${response.status}`);
    throw new ServiceError(service, code);
  }

  try {
    return await response.json();
  } catch {
    throw new ServiceError(service, ERROR_CODE.JSON_INVALID);
  }
}

/**
 * 调用DeepSeek模型
 * @param {object} settings 设置
 * @param {string} key API密钥
 * @param {Array} messages 消息数组
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<{data: any, usage: object}>}
 */
export async function deepseek(settings, key, messages, fetcher = fetch) {
  logger.debug(`调用DeepSeek模型：${settings.model}`);

  const result = await postJson(
    'https://api.deepseek.com/chat/completions',
    key,
    {
      model: settings.model,
      messages,
      response_format: { type: 'json_object' },
      thinking: {
        type: settings.thinkingEnabled === false ? 'disabled' : 'enabled'
      },
      reasoning_effort: settings.reasoningEffort ?? 'low',
      max_tokens: settings.maxTokens,
      stream: false
    },
    'DeepSeek',
    fetcher,
    settings.timeoutMs
  );

  const choice = result.choices?.[0];

  if (choice?.finish_reason !== 'stop') {
    const errorMsg = choice?.finish_reason === 'length'
      ? '输出被截断，请降低reasoningEffort或增大maxTokens'
      : '未完成正常输出';
    logger.error(`DeepSeek模型异常：${errorMsg}`);
    throw new ServiceError('DeepSeek', errorMsg, result.usage);
  }

  let data;
  try {
    data = JSON.parse(choice.message.content);
  } catch {
    logger.error('DeepSeek返回内容无法解析为JSON');
    throw new ServiceError('DeepSeek', ERROR_CODE.JSON_INVALID, result.usage);
  }

  logger.debug(`DeepSeek响应成功，输入${result.usage?.prompt_tokens}，输出${result.usage?.completion_tokens} tokens`);
  return { data, usage: result.usage ?? {} };
}

/**
 * DeepSeek搜索
 * @param {string} query 查询词
 * @param {string} key API密钥
 * @param {object} [opts] 选项
 * @returns {Promise<Array>}
 */
export async function searchWeb(query, key, opts = {}) {
  const trimmedQuery = Array.from(query.trim()).slice(0, 128).join('');
  logger.debug(`搜索：${trimmedQuery}`);

  const result = await postJson(
    'https://api.deepseek.com/v1/tools/search',
    key,
    {
      query: trimmedQuery,
      count: opts.count ?? 8,
      need_content: true
    },
    'DeepSeek Search',
    opts.fetcher ?? fetch,
    opts.timeoutMs ?? HTTP.SEARCH_TIMEOUT
  );

  if (!Array.isArray(result.results)) {
    throw new ServiceError('DeepSeek Search', ERROR_CODE.CONTENT_INVALID);
  }

  const validResults = result.results
    .filter(item => /^https?:\/\//i.test(item.url ?? ''))
    .map(item => ({
      url: item.url,
      title: item.title ?? '',
      text: item.content || item.summary || item.snippet || '',
      kind: item.content ? 'web' : 'search',
      sourceName: item.content ? 'DeepSeek Search返回正文' : 'DeepSeek Search摘要',
      status: item.content
        ? '搜索接口返回正文；需核对主体年度'
        : '搜索摘要候选，未独立读取正文',
      period: item.date ?? '未明确',
      authority: item.authority ?? -1,
      score: item.rerank_score ?? 0
    }));

  logger.debug(`搜索返回${validResults.length}条结果`);
  return validResults;
}

/**
 * DeepSeek Fetch（服务端抓取）
 * @param {string} url 网址
 * @param {string} key API密钥
 * @param {object} [opts] 选项
 * @returns {Promise<object>}
 */
export async function fetchWeb(url, key, opts = {}) {
  logger.debug(`Fetch抓取：${url}`);

  // 验证URL
  await (opts.validateURL ?? publicURL)(url);

  // 检查robots.txt
  if (!opts.skipRobotsCheck) {
    const robotsCheck = await checkRobotsPermission(url, HTTP.USER_AGENT);
    if (!robotsCheck.allowed) {
      throw new UnderwritingError(
        ERROR_CODE.ROBOTS_DISALLOWED,
        robotsCheck.reason || 'robots.txt禁止爬取'
      );
    }
  }

  const result = await postJson(
    'https://api.deepseek.com/v1/tools/fetch',
    key,
    { url },
    'DeepSeek Fetch',
    opts.fetcher ?? fetch,
    opts.timeoutMs ?? HTTP.FETCH_TIMEOUT
  );

  // 验证内容
  if (
    typeof result.content !== 'string' ||
    result.content.trim().length < VALIDATION.MIN_TEXT_LENGTH
  ) {
    throw new ServiceError('DeepSeek Fetch', ERROR_CODE.CONTENT_INVALID);
  }

  // 检测验证码
  const captchaPatterns = [
    '请输入验证码',
    '百度安全验证',
    'verify you are human',
    'just a moment'
  ];
  const preview = result.content.slice(0, 1500);
  if (captchaPatterns.some(pattern => new RegExp(pattern, 'i').test(preview))) {
    logger.warn(`检测到验证码页面：${url}`);
    throw new UnderwritingError(ERROR_CODE.CONTENT_CAPTCHA, '页面要求验证');
  }

  logger.debug(`Fetch成功，获取${result.content.length}字符`);
  return {
    url,
    title: result.title ?? url,
    text: result.content,
    kind: 'web',
    sourceName: 'DeepSeek Fetch返回正文',
    status: '服务端抓取正文；需核对主体年度',
    period: '正文所载年度'
  };
}

/**
 * 检查IP是否为私有地址
 * @param {string} ip
 * @returns {boolean}
 */
function privateIP(ip) {
  if (net.isIP(ip) === 6) {
    // IPv6私有地址
    return ip === '::' ||
           ip === '::1' ||
           /^(fc|fd|fe[89ab]|ff|::ffff:)/i.test(ip);
  }

  // IPv4私有地址
  const patterns = [
    /^0\./,
    /^10\./,
    /^127\./,
    /^169\.254\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
    /^22[4-9]\./,
    /^23\d\./,
    /^24\d\./,
    /^25[0-5]\./
  ];

  return patterns.some(pattern => pattern.test(ip));
}

/**
 * 验证URL是否为公开HTTP(S)地址
 * @param {string} value URL字符串
 * @returns {Promise<string>} 验证后的URL
 */
export async function publicURL(value) {
  const url = new URL(value);

  // 检查协议
  if (!HTTP.ALLOWED_PROTOCOLS.includes(url.protocol)) {
    throw new UnderwritingError(
      ERROR_CODE.CONTENT_INVALID,
      '只支持HTTP(S)协议'
    );
  }

  // 检查认证和端口
  if (url.username || url.password) {
    throw new UnderwritingError(
      ERROR_CODE.CONTENT_INVALID,
      '不支持包含认证信息的URL'
    );
  }

  if (url.port && !HTTP.ALLOWED_PORTS.includes(url.port)) {
    throw new UnderwritingError(
      ERROR_CODE.CONTENT_INVALID,
      `不支持的端口：${url.port}`
    );
  }

  // DNS解析并检查私有IP
  try {
    const addresses = await dns.lookup(url.hostname, { all: true });

    if (!addresses.length) {
      throw new UnderwritingError(
        ERROR_CODE.NETWORK_ERROR,
        'DNS解析失败'
      );
    }

    const hasPrivateIP = addresses.some(addr => privateIP(addr.address));
    if (hasPrivateIP) {
      logger.warn(`拒绝访问私有地址：${url.hostname}`);
      throw new UnderwritingError(
        ERROR_CODE.CONTENT_INVALID,
        '不读取本地或内网地址'
      );
    }
  } catch (error) {
    if (error instanceof UnderwritingError) throw error;
    throw new UnderwritingError(
      ERROR_CODE.NETWORK_ERROR,
      `DNS解析失败：${error.message}`
    );
  }

  return url.href;
}

/**
 * HTML转纯文本
 * @param {string} html
 * @returns {string}
 */
export const htmlText = html =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) =>
      Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 读取网页（本地HTTP请求）
 * @param {string} url 网址
 * @returns {Promise<object>}
 */
export async function readPage(url) {
  logger.debug(`本地读取网页：${url}`);

  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount < HTTP.MAX_REDIRECTS) {
    // 验证URL
    await publicURL(currentUrl);

    // 检查robots.txt
    const robotsCheck = await checkRobotsPermission(currentUrl, HTTP.USER_AGENT);
    if (!robotsCheck.allowed) {
      throw new UnderwritingError(
        ERROR_CODE.ROBOTS_DISALLOWED,
        robotsCheck.reason || 'robots.txt禁止爬取'
      );
    }

    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(HTTP.PAGE_READ_TIMEOUT),
      headers: { 'User-Agent': HTTP.USER_AGENT }
    });

    // 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new UnderwritingError(
          ERROR_CODE.REDIRECT_LOOP,
          '重定向缺少目标地址'
        );
      }
      currentUrl = new URL(location, currentUrl).href;
      redirectCount++;
      logger.debug(`重定向到：${currentUrl}`);
      continue;
    }

    if (!response.ok) {
      const code = parseHttpStatus(response.status);
      throw new UnderwritingError(code, `网页HTTP ${response.status}`);
    }

    // 检查Content-Type
    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      throw new UnderwritingError(
        ERROR_CODE.CONTENT_INVALID,
        '本版不提取PDF/二进制页面'
      );
    }

    // 读取内容
    let bytes = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > VALIDATION.MAX_PAGE_SIZE) {
        throw new UnderwritingError(
          ERROR_CODE.CONTENT_TOO_LARGE,
          '页面过大'
        );
      }
      chunks.push(chunk);
    }

    const html = Buffer.concat(chunks).toString('utf8');
    const text = htmlText(html);

    // 检测验证码
    if (
      text.length < VALIDATION.MIN_TEXT_LENGTH ||
      /百度安全验证|请输入验证码|访问验证|verify you are human|just a moment/i.test(
        text.slice(0, 1500)
      )
    ) {
      throw new UnderwritingError(
        ERROR_CODE.CONTENT_CAPTCHA,
        '页面要求验证或无可用正文'
      );
    }

    logger.debug(`成功读取网页，${text.length}字符`);
    return {
      url: currentUrl,
      title: htmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? currentUrl),
      text: text.slice(0, 16000),
      period: '网页未提取日期',
      kind: 'web',
      status: '正文已读取；内容仍需核实'
    };
  }

  throw new UnderwritingError(
    ERROR_CODE.REDIRECT_LOOP,
    '重定向次数过多'
  );
}
