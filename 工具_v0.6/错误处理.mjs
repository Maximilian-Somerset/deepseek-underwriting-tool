/**
 * 错误处理 - v0.6
 * 统一错误定义和处理逻辑
 */

import { ERROR_CODE } from './配置常量.mjs';

/**
 * 核保工具错误基类
 */
export class UnderwritingError extends Error {
  /**
   * @param {string} code 错误码
   * @param {string} message 错误消息
   * @param {*} [details] 详细信息
   */
  constructor(code, message, details = null) {
    super(message);
    this.name = 'UnderwritingError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 服务错误（API调用失败）
 */
export class ServiceError extends UnderwritingError {
  /**
   * @param {string} service 服务名称
   * @param {string} code 错误码
   * @param {*} [usage] 用量信息
   */
  constructor(service, code, usage = null) {
    super(code, `${service} ${code}`, { service, usage });
    this.name = 'ServiceError';
    this.service = service;
    this.usage = usage;
  }
}

/**
 * 解析HTTP状态码为错误码
 * @param {number} status
 * @returns {string}
 */
export function parseHttpStatus(status) {
  if (status === 401) return ERROR_CODE.ACCOUNT_UNAUTHORIZED;
  if (status === 402) return ERROR_CODE.ACCOUNT_PAYMENT_REQUIRED;
  if (status === 403) return ERROR_CODE.ACCOUNT_FORBIDDEN;
  if (status === 429) return ERROR_CODE.RATE_LIMIT;
  return `HTTP_${status}`;
}

/**
 * 判断是否为致命账户错误（需立即停止所有调用）
 * @param {Error} error
 * @returns {boolean}
 */
export function isFatalAccountError(error) {
  if (error instanceof ServiceError || error instanceof UnderwritingError) {
    return [
      ERROR_CODE.ACCOUNT_UNAUTHORIZED,
      ERROR_CODE.ACCOUNT_PAYMENT_REQUIRED
    ].includes(error.code);
  }
  // 兼容旧版字符串匹配
  return /HTTP (401|402)/.test(error.message);
}

/**
 * 判断是否为限流错误（需停止当前公司调用）
 * @param {Error} error
 * @returns {boolean}
 */
export function isRateLimitError(error) {
  if (error instanceof ServiceError || error instanceof UnderwritingError) {
    return error.code === ERROR_CODE.RATE_LIMIT ||
           error.code === ERROR_CODE.ACCOUNT_FORBIDDEN;
  }
  return /HTTP (403|429)/.test(error.message);
}

/**
 * 判断是否为网络超时错误
 * @param {Error} error
 * @returns {boolean}
 */
export function isNetworkTimeout(error) {
  if (error instanceof UnderwritingError) {
    return error.code === ERROR_CODE.NETWORK_TIMEOUT;
  }
  return error.name === 'TimeoutError' ||
         error.message?.includes('timeout') ||
         error.message?.includes('超时');
}

/**
 * 判断是否需要尝试备用方案
 * @param {Error} error
 * @returns {boolean}
 */
export function shouldTryFallback(error) {
  // 账户错误和限流不尝试备用
  if (isFatalAccountError(error) || isRateLimitError(error)) {
    return false;
  }
  // 网络错误、超时可以尝试备用
  return true;
}

/**
 * 格式化错误信息用于展示
 * @param {Error} error
 * @returns {string}
 */
export function formatErrorMessage(error) {
  if (error instanceof ServiceError) {
    return `${error.service}服务错误：${error.code}`;
  }
  if (error instanceof UnderwritingError) {
    return `${error.code}：${error.message}`;
  }
  return error.message || '未知错误';
}
