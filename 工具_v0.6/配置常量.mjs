/**
 * 配置常量 - v0.6
 * 集中管理所有配置项和魔法数字
 */

// ============ 版本信息 ============
export const VERSION = '0.6.0';
export const CRAWLER_VERSION = '0.6.0';

// ============ 校验规则 ============
export const VALIDATION = {
  // 引用最小长度（字符）
  MIN_QUOTE_LENGTH: 4,

  // 文本最小长度（字符）
  MIN_TEXT_LENGTH: 100,

  // 页面大小限制（字节）
  MAX_PAGE_SIZE: 1500000,

  // 年度范围
  MIN_YEAR: 2000,

  // 员工参保数据最早年度
  MIN_INSURANCE_YEAR: 2025,

  // PDF页码标记格式
  PDF_PAGE_MARKER_REGEX: /【PDF第(\d+)页】/g,

  // 营业额单位
  REVENUE_UNITS: ['元', '万元', '亿元'],

  // 数量单位
  COUNT_UNITS: ['人', '台', '个', '座', '套'],

  // 单位换算乘数
  UNIT_MULTIPLIERS: {
    '元': 1,
    '万元': 10000,
    '亿元': 100000000,
    '人': 1,
    '台': 1,
    '个': 1,
    '座': 1,
    '套': 1
  }
};

// ============ 搜索与爬取 ============
export const SEARCH = {
  // 查询词最大长度
  MAX_QUERY_LENGTH: 128,

  // 候选排序分数权重
  SCORE_WEIGHTS: {
    COMPANY_MATCH: 12,
    YEAR_IN_TEXT: 5,
    YEAR_IN_TITLE_WITH_REPORT: 12,
    AUTHORITY_DOMAIN: 5,
    PDF_FILE: 3,
    FIELD_MATCH: 5,
    AUDIT_REPORT_KEYWORD: 3,
    ATTACHMENT: 18,
    RECRUITMENT_PENALTY: -8
  },

  // 权威域名列表
  AUTHORITY_DOMAINS: [
    'cninfo.com.cn',
    'sse.com.cn',
    'szse.cn',
    'gov.cn',
    'pdf.dfcfw.com'
  ],

  // 排除关键词（降低优先级）
  EXCLUDE_KEYWORDS: ['工资', '待遇', '招聘'],

  // 重点关键词
  PRIORITY_KEYWORDS: ['审计报告', '年度报告', '跟踪评级']
};

// ============ 文本摘录 ============
export const EXCERPT = {
  // 首部保留长度
  HEADER_LENGTH: 900,

  // 匹配前后文长度
  BEFORE_MATCH: 650,
  AFTER_MATCH: 1500,

  // 单个匹配最小长度
  MIN_MATCH_LENGTH: 200,

  // 每个字段最多摘录数
  MAX_EXCERPTS_PER_FIELD: 3
};

// ============ 来源选择 ============
export const SOURCE_SELECTION = {
  // 本地材料预算比例
  LOCAL_BUDGET_RATIO: 0.3,

  // 单个本地来源最大长度
  MAX_LOCAL_SOURCE_LENGTH: 8000,

  // 单个网页来源最大长度（普通）
  MAX_WEB_SOURCE_LENGTH: 12000,

  // 单个网页来源最大长度（已选页）
  MAX_WEB_SOURCE_WITH_PAGES: 30000,

  // 最小公平分配长度
  MIN_FAIR_LIMIT: 1500,

  // 最多选择来源数
  MAX_SOURCES: 12,

  // 字段优先槽位数
  FIELD_PRIORITY_SLOTS: 2
};

// ============ HTTP请求 ============
export const HTTP = {
  // 默认超时（毫秒）
  DEFAULT_TIMEOUT: 90000,

  // 搜索超时
  SEARCH_TIMEOUT: 45000,

  // Fetch超时
  FETCH_TIMEOUT: 45000,

  // 页面读取超时
  PAGE_READ_TIMEOUT: 18000,

  // 最大重定向次数
  MAX_REDIRECTS: 4,

  // User-Agent
  USER_AGENT: 'UnderwritingResearch/0.6',

  // 允许的协议
  ALLOWED_PROTOCOLS: ['http:', 'https:'],

  // 允许的端口
  ALLOWED_PORTS: ['80', '443']
};

// ============ 错误码定义 ============
export const ERROR_CODE = {
  // 账户权限错误
  ACCOUNT_UNAUTHORIZED: 'ACCOUNT_401',
  ACCOUNT_PAYMENT_REQUIRED: 'ACCOUNT_402',
  ACCOUNT_FORBIDDEN: 'ACCOUNT_403',

  // 限流错误
  RATE_LIMIT: 'RATE_LIMIT_429',

  // 网络错误
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',

  // 内容错误
  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE',
  CONTENT_INVALID: 'CONTENT_INVALID',
  CONTENT_CAPTCHA: 'CONTENT_CAPTCHA',

  // 爬虫错误
  ROBOTS_DISALLOWED: 'ROBOTS_DISALLOWED',
  REDIRECT_LOOP: 'REDIRECT_LOOP',

  // 解析错误
  PARSE_ERROR: 'PARSE_ERROR',
  JSON_INVALID: 'JSON_INVALID'
};

// ============ 日志级别 ============
export const LOG_LEVEL = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// 当前日志级别（可通过环境变量覆盖）
export const CURRENT_LOG_LEVEL = process.env.LOG_LEVEL
  ? LOG_LEVEL[process.env.LOG_LEVEL.toUpperCase()] ?? LOG_LEVEL.INFO
  : LOG_LEVEL.INFO;

// ============ Node.js 检测路径 ============
export const NODE_SEARCH_PATHS = [
  // Codex运行时
  process.env.USERPROFILE + '\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe',
  // 系统Node.js
  'C:\\Program Files\\nodejs\\node.exe',
  'C:\\Program Files (x86)\\nodejs\\node.exe',
  // 环境变量中的Node
  process.env.NODE_PATH ? process.env.NODE_PATH + '\\node.exe' : null,
  // 直接使用PATH中的node命令
  'node'
].filter(Boolean);
