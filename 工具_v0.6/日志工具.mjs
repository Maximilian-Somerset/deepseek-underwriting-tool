/**
 * 日志工具 - v0.6
 * 提供分级日志输出
 */

import { LOG_LEVEL, CURRENT_LOG_LEVEL } from './配置常量.mjs';

/**
 * 日志记录器
 */
export class Logger {
  constructor(prefix = '') {
    this.prefix = prefix;
    this.level = CURRENT_LOG_LEVEL;
  }

  /**
   * 设置日志级别
   * @param {keyof typeof LOG_LEVEL} level
   */
  setLevel(level) {
    this.level = LOG_LEVEL[level] ?? LOG_LEVEL.INFO;
  }

  /**
   * 错误日志
   * @param {string} message
   * @param {Error} [error]
   */
  error(message, error = null) {
    if (this.level >= LOG_LEVEL.ERROR) {
      const prefix = this.prefix ? `[${this.prefix}] ` : '';
      console.error(`❌ ${prefix}${message}`);
      if (error && error.stack) {
        console.error(error.stack);
      }
    }
  }

  /**
   * 警告日志
   * @param {string} message
   */
  warn(message) {
    if (this.level >= LOG_LEVEL.WARN) {
      const prefix = this.prefix ? `[${this.prefix}] ` : '';
      console.warn(`⚠️  ${prefix}${message}`);
    }
  }

  /**
   * 信息日志
   * @param {string} message
   */
  info(message) {
    if (this.level >= LOG_LEVEL.INFO) {
      const prefix = this.prefix ? `[${this.prefix}] ` : '';
      console.log(`ℹ️  ${prefix}${message}`);
    }
  }

  /**
   * 调试日志
   * @param {string} message
   * @param {*} [data]
   */
  debug(message, data = null) {
    if (this.level >= LOG_LEVEL.DEBUG) {
      const prefix = this.prefix ? `[${this.prefix}] ` : '';
      console.log(`🔍 ${prefix}${message}`);
      if (data !== null) {
        console.log(JSON.stringify(data, null, 2));
      }
    }
  }

  /**
   * 进度日志（总是显示）
   * @param {string} message
   */
  progress(message) {
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    console.log(`⏳ ${prefix}${message}`);
  }

  /**
   * 成功日志（总是显示）
   * @param {string} message
   */
  success(message) {
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    console.log(`✅ ${prefix}${message}`);
  }

  /**
   * 创建子日志器
   * @param {string} subPrefix
   * @returns {Logger}
   */
  child(subPrefix) {
    const childPrefix = this.prefix ? `${this.prefix}:${subPrefix}` : subPrefix;
    const child = new Logger(childPrefix);
    child.level = this.level;
    return child;
  }
}

// 默认日志器
export const logger = new Logger();
